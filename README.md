# SimplyStore

SimplyStore is an attempt to create a radically simpler backend storage server. It does not have a database, certainly no SQL or GraphQL, it is not REST. In return it has a well defined API that is automatically derived from your dataset. It supports JSONTag to allow for semantically meaningful data, without having to do the full switch to Linked Data and triple stores. The query format is javascript, you can post javascript queries that will run on the server. All data is read into memory and is available to these javascript queries without needing (or allowing) disk access or indexes.

[JSONTag](https://github.com/poef/jsontag) is an enhancement over JSON that allows you to tag JSON data with metadata using HTML-like tags.
Javascript queries are run in a [VM2](https://www.npmjs.com/package/vm2) sandbox.


## Installation

SimplyStore is a Node application. Start it by downloading this git repository:

```shell
git clone git@github.com:simplyedit/simplystore
```

Then install its dependencies:

```shell
cd simplystore
npm install
```

And start it up:

```shell
npm start 
```

The server comes with a small demo dataset, which you can take a look at here `http://localhost:3000/`:

This page will show this:

```
{
    "persons":<link>"persons/"
}
```

By following the link to `http://localhost:3000/persons/` you get:

```
[
    <object class="Person">{
        "name":"John",
        "dob":<date>"1972-09-20"
    },
    <object class="Person">{
        "name":"Jane",
        "dob":<date>"1986-01-01"
    }
]
```

## Goals of this project

SimplyStore is an attemp to see if we can create a more defined and usable REST like service, out of the box. One where all you need to do is change the data and add some access rights and get a self-describing, browseable, working API.

The SimplyStore design is predicated on the following realisations:
1 - Most data today will fit comfortably in memory in a commodity server.
2 - REST today is usually JSON-over-HTTP, but JSON crucially misses a <link> type.
3 - JSON is never just JSON. You need additional things like JSON-LD or JSON-Schema, to make sense of it. 
4 - There is no clear onramp from JSON to Linked Data.
5 - Linked Data is very good for data / information exchange, but very costly for data manipulation and querying.

So the scope for jsontag-rest-server is:
- datasets that will fit comfortably in memory, for now I've set a test goal of about 1GB of data.
- usecases that are mostly-read, with sparse updates.
- scale-in-depth, so scale up is limited to the limits of a single computer system
- linked data (RDF et al) is not an immediate concern, but there must be a plausible onramp / conversion to and from linked data.

In addition, SimplyStore is meant to be a real-world testcase for JSONTag.

## Roadmap

[v] immutable dataset
- allow changes to dataset by creating a new root
- command handling with crud commands and command log
- backup current dataset to JSONTag file
- on startup check if any commands in the log haven't been resolved, if so run them

- improved web client with type-specific views and form elements

- Datalog query support
  [v] compile triple store from jsontag data
  [v] add query method
  [v] extend datalog query to allow for custom match functions
  [v] run /query post body in VM2 sandbox
  [v] immutable dataset in query vm
  - add indexing and other optimizations
  - add standard library of matching functions
  - allow vanilla javascript array map/reduce/filter approach

- add support for metadata on each JSON pointer path (or better: each object)
- allow custom templates, instead of the default index.html
- add support for access control, based on webid / openid connect

