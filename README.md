# JSONTag REST Server

[JSONTag](https://github.com/poef/jsontag) is an enhancement over JSON that allows you to tag JSON data with metadata using HTML-like tags. This application is a prototype REST-like server using JSONTag, mostly to testdrive JSONTag and what applications using it would look like.

## Installation

JSONTag-rest-server is a Node application. Start it by downloading this git repository:

```shell
git clone git@github.com:poef/jsontag-rest-server
```

Then install its dependencies:

```shell
cd jsontag-rest-server
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

JSONTag is an experiment, this server is part of that. The idea is to see if we can create a more defined and usable REST like service, out of the box. One where all you need to do is change the data and add some access rights and get a self-describing, browseable, working API.

The jsontag-rest-server design is predicated on the following realisations:
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

In addition, the jsontag-rest-server is meant to be a real-world testcase for JSONTag.

## Design

The current version is just a readonly API. The next version will allow you to update the data. It will use a CQRS (Command-Query-Responsibility-Segragation) approach. 

The Query part will use the url path as a JSON Pointer, just like the current version. It will also add a graphql-like query feature. Eventually this will support a JSONTag selector, similar to CSS Selectors, combined with JSON Pointer abilities.

The Command part will have a seperate single entry point, with a predefined set of default commands to get a CRUD like experience. Commands will always be processed sequentially. Commands are appended to a command log.

A command can change the dataset, but only by creating new entities. The dataset is immutable. This makes it possible to do atomic updates. Each dataset has a single root entity. A command can create a new dataset root entity, which links to new entities or existing entities. This way the atomic update is done by switching the root entity for the dataset for both the next Command and Queries.

Then the server will update a on-disk backup of the current state at specific times, to be determined.

Next the server can start multiple Query processes using the same dataset using shared memory, since they are immutable. When the dataset root is changed, old query processes are killed of (after processing their last request) and replaced with new query processes using the new dataset root.

This should make the whole system ACID compliant. The atomic switching of the dataset root and immutable nature of the dataset makes sure that each query is always resolved using an internally consistent dataset. The sequential processing of the commands makes sure that there are no possible race conditions.

## Roadmap

- immutable dataset
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

