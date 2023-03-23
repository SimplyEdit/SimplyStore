JSONTag

- streaming parser (handrolled for performance)
- option: documentURL
	automatically enhance id's as urls with baseURL the documentURL
	do this for <link> as well as id attributes
- option: parent index
	when parsing, keep track of the parent for each value, and add it to a WeakMap index.parents, this contains all objects with a reference to the object used as key.
- object id and link value should always be URI's, and should be identical. If the link value starts with a '#', then the id should also start with a '#'. 
- fast-parse doesn't enforce parsing rules for specific tags yet

JSONTag REST Server

- think of a better name (iets met live?) simplyStore?
- add a set of default functions / standard library to walk/map/reduce over the data. Like the arc/tree methods, e.g. dive. Note: JSONTag data is a graph, so it can contain circular references, make sure you don't walk into an infinite loop. Keep track of which objects have already been walked over.
- create extra indexes to speed up 'common' searches, e.g. give me all objects with class X that are contained/child/descendant of Y. (like the JSONPath `$..book` expression)

JSONTag REST Server Commands
- create endpoint POST /update/ for example
- syntax of commands should be simple and easily parsible
- create a log of all commands, with a unique id per command
- commands are javascript methods defined serverside in a commands.js file / commands object
- each command is a transaction, it succeeds wholly or fails wholly
- commands may have preconditions, if not met, they fail
- when sending a command, you get back the generated command id immediately
- you can (long) poll for the status of a command (pending, success, failed)
	GET /update/{uuid}
- there should be an SSE event bus endpoint that allows you to listen wihtout polling




