# SimplyStore

SimplyStore is a radically simpler backend storage server. It does not have a database, certainly no SQL or GraphQL, it is not REST. In return it has a well defined API that is automatically derived from your dataset. It supports JSONTag to allow for semantically meaningful data, without having to do the full switch to Linked Data and triple stores. The query format is javascript, you can post javascript queries that will run on the server. All data is read into memory and is available to these javascript queries without needing (or allowing) disk access or indexes.

[JSONTag](https://github.com/poef/jsontag) is an enhancement over JSON that allows you to tag JSON data with metadata using HTML-like tags.
Javascript queries are run in a [VM2](https://www.npmjs.com/package/vm2) sandbox. 
You can query data using the [array-where-select](https://www.npmjs.com/package/array-where-select) extension.

Note: _There are known security issues in VM2, so the project will switch to V8-isolate. For now make sure SimplyStore is not publically accessible, by adding an api gateway in front of it for example_

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Example Query](#examples)
- [Goals](#goals)
- [Roadmap](#roadmap)
- [License](#license)

<a name="background"></a>
## Background

<a name="install"></a>
## Install

SimplyStore is a Node library. You can install it in your application like this:

```shell
npm install @muze-nl/simplystore
```

<a name="usage"></a>
## Usage

Import the server in your main file like this:

```javascript
import simplystore from '@muze-nl/simplystore'
```

Then configure and start the server, like this:

```javascript
simplystore.run({
    datafile: process.cwd().'data.json'
})
````

Other options are:

- port: The port number to use, defaults to 3000
- dataspace: an object or array with all the data that SimplyStore will serve. Optional, replaces the datafile.

If you start your server:

```shell
node myApp.js
```

You should be able to go http://localhost:3000/query/ and see something like this:

![image](https://github.com/SimplyEdit/SimplyStore/assets/1006453/3bec6b97-ffa1-4114-9ed4-51a68f73476e)

<a name="examples"></a>
## Example query

Given a dataset like this (jsontag):

```
{
    "persons": [
        <object id="john" class="Person">{
            "name": "John",
            "lastName": "Doe",
            "dob": <date>"1972-09-20",
            "foaf": [
                <link>"jane"
            ]
        },
        <object id="jane" class="Person">{
            "name": "Jane",
            "lastName": "Doe",
            "dob": <date>"1986-01-01",
            "foaf": [
                <link>"john"
            ]
        }
    ]
}
```

You can post to the /query/ endpoint with javascript queries like these:

```
from(data.persons)
.where({
    name: 'John'
})
.select({
    name: _,
    foaf: {
        name: _
    }
})
```

See the [query documentation](docs/queries.md) for more information about the query possibilities.

Remember: it is just javascript, so you can also use filter(), map() and reduce() on arrays. You can use all the default javascript API's, like Math, Array, Object, etc. You can not use any webbrowser API's, and you can't access any NodeJS API's. You do not have network access in your query.

Most important: queries cannot change the dataset, it is immutable.

## Example SimplyStore server

The example directory contains a server that uses SimplyStore to serve a
Star Wars API. 

To start it:

```shell
cd example/
npm install
npm start
```

Now go to http://localhost:3000/query/ and you can run all the example
queries from the [query documentation](docs/queries.md)

<a name="goals"></a>
## Goals of this project

SimplyStore is a more defined and usable REST like service, out of the box. One where all you need to do is change the data and add some access rights and get a self-describing, browseable, working API.

The SimplyStore design is predicated on the following realisations:

  1. Most data today will fit comfortably in memory in a commodity server.
  2. REST today is usually JSON-over-HTTP, but JSON crucially misses a <link> type.
  3. JSON is never just JSON. You need additional things like JSON-LD or JSON-Schema, to make sense of it. 
  4. There is no clear onramp from JSON to Linked Data.
  5. Linked Data is very good for data / information exchange, but very costly for data manipulation and querying.

So the scope for SimplyStore is:

- datasets that will fit comfortably in memory, for now I've set a test goal of about 1GB of data.
- usecases that are mostly-read, with sparse updates.
- scale-in-depth, so scale up is limited to the limits of a single computer system
- linked data (RDF et al) is not an immediate concern, but there must be a plausible onramp / conversion to and from linked data.

In addition, SimplyStore is meant to be a real-world testcase for JSONTag.

<a name="roadmap"></a>
## Roadmap

- [v] allow changes to dataset by creating a new root
- [v] command handling with crud commands and command log
- [v] backup current dataset to JSONTag file
- [v] on startup check if any commands in the log haven't been resolved, if so run them

- [ ] improved web client with type-specific views and form elements

- [x] add support for metadata on each JSON pointer path (or better: each object)
- [ ] allow custom templates, instead of the default index.html
- [ ] add support for access control, based on webid / openid connect
- [ ] switch from VM2 to V8-isolate, which is more secure
- [x] switch the server runtime to Rust, so SimplyStore can share immutable data between threads

<a name="license"></a>
## License

[MIT](LICENSE) © Muze.nl
