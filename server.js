/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
/* jshint node:true */

// Add the express web framework
const express = require("express");
const app = express();

// Use body-parser to handle the PUT data
const bodyParser = require("body-parser");
app.use(
    bodyParser.urlencoded({
        extended: false
    })
);

// Util is handy to have around, so thats why that's here.
const util = require('util')
// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
let port = process.env.PORT || 8080;

// Then we'll pull in the database client library
const cassandra = require('cassandra-driver');

// Use the address translator
const compose = require('composeaddresstranslator');

// Now lets get cfenv and ask it to parse the environment variable
const cfenv = require('cfenv');

// load local VCAP configuration  and service credentials
let vcapLocal;
try {
  vcapLocal = require('./vcap-local.json');
  console.log("Loaded local VCAP");
} catch (e) { 
    // console.log(e)
}

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}
const appEnv = cfenv.getAppEnv(appEnvOpts);

// Within the application environment (appenv) there's a services object
let services = appEnv.services;

// The services object is a map named by service so we extract the one for PostgreSQL
let scylladb_services = services["compose-for-scylladb"];

// This check ensures there is a services for MySQL databases
assert(!util.isUndefined(scylladb_services), "Must be bound to compose-for-scylladb services");

// We now take the first bound MongoDB service and extract it's credentials object
let credentials = scylladb_services[0].credentials;

// get a username and password from the uri
const url = require('url');
let myURL = url.parse(credentials.uri);
let auth = myURL.auth;
let splitAuth = auth.split(":");
let username = splitAuth[0];
let password = splitAuth[1];
let sslopts = myURL.protocol === "https:" ? {} : null;

// get contactPoints for the connection
let translator=new compose.ComposeAddressTranslator();
translator.setMap(credentials.maps);

let authProvider = new cassandra.auth.PlainTextAuthProvider(username, password)
let uuid = require('uuid')

let client = new cassandra.Client({
  contactPoints: translator.getContactPoints(),
  policies: {
      addressResolution: translator
  },
  authProvider: authProvider,
  sslOptions: sslopts
});

// Add a word to the database
function addWord(word, definition) {
  return new Promise(function(resolve, reject) {
      client.execute(
          "INSERT INTO grand_tour.words(my_table_id, word, definition) VALUES(?,?,?)", [uuid.v4(), word, definition], { prepare: true },
          function(error, result) {
              if (error) {
                  console.log(error);
                  reject(error);
              } else {
                  resolve(result.rows);
              }
          }
      );
  });
}

// Get words from the database
function getWords() {
  return new Promise(function(resolve, reject) {
      // execute a query on our database
      client.execute("SELECT * FROM grand_tour.words", function(err, result) {
          if (err) {
              console.log(err);
              reject(err);
          } else {
              //console.log(result.rows);
              resolve(result.rows);
          }
      });
  });
}

// We can now set up our web server. First up we set it to serve static pages
app.use(express.static(__dirname + "/public"));

// The user has clicked submit to add a word and definition to the database
// Send the data to the addWord function and send a response if successful
app.put("/words", function(request, response) {
  addWord(request.body.word, request.body.definition)
      .then(function(resp) {
          response.send(resp);
      })
      .catch(function(err) {
          console.log(err);
          response.status(500).send(err);
      });
});

// Read from the database when the page is loaded or after a word is successfully added
// Use the getWords function to get a list of words and definitions from the database
app.get("/words", function(request, response) {
  getWords()
      .then(function(words) {
          response.send(words);
      })
      .catch(function(err) {
          console.log(err);
          response.status(500).send(err);
      });
});

console.log("Connecting");

// create a keyspace and a table if they don't already exist
client
  .execute(
      "CREATE KEYSPACE IF NOT EXISTS grand_tour WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '3' };"
  )
  .then(result =>
      client
      .execute(
          "CREATE TABLE IF NOT EXISTS grand_tour.words (my_table_id uuid, word text, definition text, PRIMARY KEY(my_table_id));"
      )
      .then(result => {
          app.listen(port, function() {
              console.log("Server is listening on port " + port);
          });
      })
      .catch(err => {
          console.log(err);
          process.exit(1);
      })
  );
