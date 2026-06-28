# Workbench UI

Goal: create a webbased UI to manage SimplyStore. Inspiration is mysqladmin and similar UI's.

The Workbench should allow a user to explore the dataset, create and run queries. If the dataset isn't public, the user must login to gain access. 

In addition if you have administrator access the workbench should give you access to the list of users, and their access levels. You should be able to add/alter/remove users.

Administrators should be able to alter the SimplyStore configuration. E.g. how many threads to run, how long the /query endpoint may run before triggering a timeout, etc.

Developers should be able to list all commands, show a command, alter a command, test the altered command, and publish the altered command.

Any changes to command code must be kept in a version control system, so developers can see changes, who changed them, and why. And potentially revert those changes.

Developers should be able to define indexes, which will get updated automatically on any change. They should also be able to re-index the entire dataset again.

## necessary building blocks

These things must be available before this workbench can be built:

- Authentication and Authorization (login and grants, and roles/groups)
- Built-in version control of commands
- Ability to edit commands and update the server while it is running
- Ability to add/alter index code separate from commands


## Automatic Indexing

The idea is that you define indexes outside of commands. Any command that changes data should trigger all index code that may need to run. So commands will only alter the dataset itself, the indexes will update the index information. This last may also be a part of the dataset, e.g. as non-enumerable properties. It may also be stored in the `meta.index` part of SimplyStore.

Each index is defined as

```javascript
server.addIndex(function(data, changes, meta) {

})
```

Any object that is changed is listed in the changes array. You don't have information about what specifically is changed. So best option is to simply update any index that is affected by each object.

### Re-index

Currently indexing is part of the initial creation of data.jsontag. It should be possible to 
1. re-index data.jsontag at any time
2. automatically index data.jsontag after initial creation
3. update indexes for any object changed in a command

This way there is never a disconnect between indexing that happens in a command, or during initial setup.
This also means, that initial setup must have access to a SimplyStore server instance. The simplest way would be to create a separate server instance that you can run as part of a nodejs script. Instead of connecting with the live server. One problem is that this server must not conflict with the actuall running server (accessible through a port)

So either create a separate working directory for the in-process server, and only update the live server after everything is done. Or 'freeze' the running server (it won't process any commands).

### Initial ID index

Currently the `meta.index.id` is built up by reading the entire dataset in the load-worker, and parsing everything to get to each id attribute. But as the data.jsontag files are immutable, it should be trivial to create an index on creation. Store it as index.json (and index.uuid.json for each changeset) and read that in on startup. This avoids reading everything into memory and parsing everything on startup.

### Other indexes

If we allow for the id index to be saved in `index.json`, we could do the same for other types of indexes. At least for those accessible through `meta.index`, e.g. `meta.index.id`, `meta.index.type`, etc.

To handle this automatically, the index function `meta` parameter should keep track of any changes made through it, and store those changes in an `index.uuid.json` automatically.

Indexes should have a Map structure, which is stored as JSON objects, e.g.:

```json
{
	"id": {
		"{uuid}": 999
	},
	"type": {
		"Foo": {
			"ins": [10, 18],
			"del": [0, 10]
		}
	}
}
```

If you remove an object, the line number is not re-used. So you can just do this: (assume nr. 999 is removed)

```json
{
	"id": {
		"{uuid}": null
	},
	"type": {
		"Foo": {
			"del": [999]
		}
	}
}
```

The type index should not re-iterate existing information, so for the `index.uuid.json` files, it should have `patch` semantics. The root `index.json` should just use an array, e.g.:

```json
{
	"id": {
		"{uuid}": 999
	},
	"type": {
		"Foo": [0, 10],
		"Bar": [1,2,3,4,5,6,7,8,9]
	}
}
```

Each of the index values (the right hand side numbers) is a reference to an offset in the od-jsontag dataspace resultArray.