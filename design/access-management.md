# access management (grants/rights/roles)

## Read grants

You can easily create a read access check that just checks the query/ endpoint, but this is not interesting.
Much more interesting is how to implement granular read access rights on subtrees of the dataset.

Ariadne has a mechanism that has been succesfully used since 1998. It allows you to defined grant strings, like 'read', 'edit', etc. and configure them on a path inside a tree of data. Each entity below that path will automatically inherit the grant.

The grant is then checked for each interaction with the data. Because all interactions in Ariadne are through templates, which can be custom made, the grants can also be custom strings. This way you can grow the access management system to your own needs.

However, this means that all read access must come through the data tree. Earlier we defined a /uuid/ endpoint which would give direct access to any object. This breaks this paradigm. Objects can be linked in multiple locations in the dataset. To check for read grants, you must find all valid paths to an object and check if any of them allow the user to 'read' the object. This is potentially very costly.

The easiest solution is to drop the /uuid endpoint, unless all data is publically readable. Each object can still have a uuid, but it is no longer a url that points to the objects contents.

Another problem is the changing nature of the JSON Pointer path in the URL. If an object is part of an array, and another object earlier (with smalled index) is removed, the URL for this object changes. Its index is lowered. So you cannot assign grants on a JSON Pointer path, containing an array index, with any hope of the grants staying in the correct spot.

If you instead assign grants to objects directly, the grants will correctly move when an array is updated. However this opens up the possibility that grants appear in multiple places, if the object is linked in multiple places. This should not be a problem though, since the subtree of objects is the same as long as the object is the same.

This opens up the possibility of storing the grants in an attribute on the JSONTag tag of the object. e.g.

&lt;object class="Site" grants="user1: read edit, user2: read edit delete"&gt;{ ... }

Here we need to carefully consider how to treat links. Do we need read access to follow a link, or is that implied?

## Update

You can define your own access check method like this. First create an `access.mjs` file with your access method, e.g:

```javascript
export default function access(object, property, method) {
	if (property=='gender') {
		return false
	}
	return true
}
```

The in your `server.mjs` file, add the `access` property to `SimplyStore.run`:
```javascript
import SimplyStore from '../src/server.mjs'

SimplyStore.run({
	datafile: process.cwd()+'/data.jsontag',
	commandsFile: process.cwd()+'/commands.mjs',
	commandLog: process.cwd()+'/command-log.jsontag',
	access: process.cwd()+'/access.mjs'
})
```

Note that the access function is called for each get access on each object. So it is critical that it is fast and doesn't use much memory.
