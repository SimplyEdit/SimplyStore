# SimplyStore

SimplyStore is a radically simpler backend storage server. It does not have a database, certainly no SQL or GraphQL, it is not REST. In return it has a well defined API that is automatically derived from your dataset. It supports JSONTag to allow for semantically meaningful data, without having to do the full switch to Linked Data and triple stores. The query format is javascript, you can post javascript queries that will run on the server. Dataset records are read lazily from indexed files. Javascript queries use ordinary objects and arrays; SimplyStore manages file access and indexes.

[JSONTag](https://github.com/muze-nl/jsontag) is an enhancement over JSON that allows you to tag JSON data with metadata using HTML-like tags.
Javascript queries are run in a [VM2](https://www.npmjs.com/package/vm2) sandbox. 
You can query data using the [jaqt](https://github.com/muze-nl/jaqt/)  library.

Note: _There are known security issues in VM2, so the project will switch to V8-isolate. For now make sure SimplyStore is not publically accessible, by adding an api gateway in front of it for example_

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [File-backed Data](docs/file-data.md)
- [Custom Index Modules](#custom-index-modules)
- [Example Query](#examples)
- [Goals](#goals)
- [Roadmap](#roadmap)
- [License](#license)
- [Contributions](#contributions)

<a name="install"></a>
## Install

SimplyStore is a NodeJS/[ExpressJS](https://expressjs.com/) library. You can install it in your application like this:

```shell
npm install @muze-nl/simplystore
```

<a name="usage"></a>
## Usage

Import the server in your main file like this:

```javascript
import simplystore from '@muze-nl/simplystore'
```

Initialize the store first using the [conversion procedure](docs/recovery.md#configure-and-initialize); opening an existing store requires its base and logs. Then configure and start the server:

```javascript
simplystore.run({
    datafile: './store/data.jsontag',
    commandLog: './store/command-log.jsontag',
    commandStatus: './store/command-status.jsontag'
})
```

simplystore is an [express application](https://expressjs.com/), with all the usual options. Other options are:

- port: The port number to use, defaults to 3000
- commandsFile: the module implementing commands; every invocation input must be in the logged command. HTTP request context is not passed to handlers.

If you start your server:

```shell
node myApp.js
```

You should be able to go http://localhost:3000/query/ and see something like this:

![image](https://github.com/SimplyEdit/SimplyStore/assets/1006453/3bec6b97-ffa1-4114-9ed4-51a68f73476e)

## Durability and recovery

See the [durability contract](DURABILITY.md) and [administrator recovery guide](docs/recovery.md). Command-log order governs execution. Acceptance and completion await file and directory barriers. Uncertain or pending work found at startup requires administrator assessment; missing data does not prove that external effects did not happen. Existing store formats are retained without migration.

## File-backed data

See the [file-backed data guide](docs/file-data.md) for worker/file lifetimes,
index rebuilding, memory limits, and the internal worker-message changes.
Existing stores retain their current formats and need no conversion.

## Custom Index Modules

Use `indexFile` to configure a module whose default export provides the existing
`create(data, meta)`, `update(data, meta, changes)`, and `load(meta, uuid)` methods.
Conversion calls `create`; commands call `update` when changes are present.
These hooks run before final serialization and may update derived data.

After writing the serialized data, SimplyStore awaits
`finalize(serialized, meta, uuid)`. Existing modules without this optional method
automatically use the default finalizer, which writes correct offset indexes.
Wrappers that only override `create`, `update`, and `load` need no changes.

To extend finalization, delegate to the default implementation:

```javascript
import index from '@muze-nl/simplystore/src/index.mjs'

export default {
    ...index,
    async finalize(serialized, meta, uuid = null) {
        await index.finalize(serialized, meta, uuid)
        // Write any additional derived files here.
    }
}
```

`serialized` contains the final OD-JSONTag output: a string during conversion
or a `Uint8Array` for a command changeset. `meta.data` is the output directory;
`uuid` is `null` for conversion or the command ID for a changeset. Treat the
serialized input and canonical data as read-only during finalization. The custom
method receives its original object as `this` and is called once, including for
empty command changesets.

A custom finalizer replaces the default, so delegate as above to retain standard
offset files. Rejections fail conversion or the command before success is
reported. Files already written may remain; finalization is not an atomic
transaction across all data and index files.

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

  1. Files provide lazy record access; indexes and active edits still use memory.
  2. REST today is usually JSON-over-HTTP, but JSON crucially misses a <link> type.
  3. JSON is never just JSON. You need additional things like JSON-LD or JSON-Schema, to make sense of it. 
  4. There is no clear onramp from JSON to Linked Data.
  5. Linked Data is very good for data / information exchange, but very costly for data manipulation and querying.

So the scope for SimplyStore is:

- datasets whose indexes and active working set fit in memory, with file-backed record storage.
- usecases that are mostly-read, with sparse updates.
- scale-in-depth, so scale up is limited to the limits of a single computer system
- linked data (RDF et al) is not an immediate concern, but there must be a plausible onramp / conversion to and from linked data.

In addition, SimplyStore is meant to be a real-world testcase for JSONTag.

<a name="roadmap"></a>
## Roadmap

- [x] allow changes to dataset by creating a new root
- [x] command handling with crud commands and command log
- [x] backup current dataset to JSONTag file
- [x] on startup check if any commands in the log haven't been resolved, if so run them
- [x] add support for access control, ~~based on webid / openid connect~~
- [ ] stress test ACID compliance
- [ ] improved web client with type-specific views and form elements
- [ ] improved developer experience, with online command editor and eslint
- [ ] optional schema definitions and validation
- [ ] allow custom templates, instead of the default index.html
- [ ] switch from VM2 to V8-isolate or QuickJS, which is more secure

<a name="license"></a>
## License

[MIT](LICENSE) © Muze.nl

## Contributions
Contributions are welcome, but make sure that all code is MIT licensed. If you want to send a merge request, please make sure that there is a ticket that shows the bug/feature and reference it. If you find any problem, please do file a ticket, but you should not expect a timely resolution. This project is still very experimental, don't use it in production unless you are ready to fix problems yourself.
