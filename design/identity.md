# Identity

One of many pitfalls in REST API's is mismanaging of the identity of entities. So we need to get this right here.

- Each entity should have exactly one identity, over time. You can have different versions of an entity, as in older versions that have been updated since. The main identity always points to the latest version in that case.
- Each identity should be a URL. This is because we want to make sure we can easily upgrade the API to a Linked Data API.
- If you implement versioning, you should be able to reference a specific version, also through a URL.
- If the JSONTag data adds a link to an object/entity, it should use the same ID (URL)
- Each entity must have a unique ID

A simple solution would be to use the API URL + JSON Pointer as the id of all entities. This fails for these reasons (at least):
- Entities may appear on multiple JSON Pointer paths, as they can be linked in multiple places
- Entities that are part of an array of entities, may have there JSON Pointer path changed when another, prior, entity is removed from the array. e.g.

```jsontag
[
	{
		"title":"Entity 1"
	},
	{
		"title":"Entity 2"
	}
]
```

Here you could select entity 2 using the JSON Pointer '/1/'. However as soon as entity 1 is removed, the JSON Pointer would become '/0/'.

Another solution would be to explicitly assign all objects a unique id, perhaps a UUID. Then you can use that with a specific Map container, e.g.

```
/uuid/9b91dcfd-dae7-47dc-b90f-a51b37e6dd3e
```

And all results would have their id encoded like this:

```jsontag
[
	<object id="/uuid/9b91dcfd-dae7-47dc-b90f-a51b37e6dd3e">{
		"title":"Entity 2"
	}
]
```

The problem here is that the system now forces everything to use a specific UUID type as ID. This may not be the best option. And the URL that is used as the ID is much less expressive than it could be. All entities are forced to use the same non-descriptive ID style. The benefit is that at least some common pitfalls in assigning ID values are avoided...

The /uuid/ map should be invisible, as in, it should not be returned in any result. You can only use it to query a specific entity by ID.
UUID's should only be assigned to object values. All other values are supposed to be just values, even if they get parsed into Value Objects, like `<date>`.

One possible problem is that we've now encoded the identity as an attribute, instead of a property. This may come as a surprise to users of the API. However I do think that it is a better fit. Consider the JSON-LD '@id' property, which fulfills a similar role. It too is encoded seperate from normal properties, using the '@' prefix.

The /uuid/ endpoint can be written as a search in the dataset for an entity with the given ID. This way it is not part of the dataset itself, and thus 'invisible'.

If you need versioning, you could add a second parameter for the version, like this:

```
/uuid/9b91dcfd-dae7-47dc-b90f-a51b37e6dd3e/1
```

or

```
/uuid/9b91dcfd-dae7-47dc-b90f-a51b37e6dd3e/latest
```

To prevent collisions with a 'uuid' property in the dataset root, a normal JSON Pointer for the dataset could start with the `/query/` root path, e.g.:

```
api.url/query/tasks/
```

This would also make room for a seperate `/update/` path, which would handle update commands to the dataset.