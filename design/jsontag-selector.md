# JSONTag-selector or query

This document is now here for historical reference only. SimplyStore now uses the [npm package array-where-select](https://www.npmjs.com/package/array-where-select) as its default query or selector algorithm. In addition work is ongoing on a triplestore implementation with a datalog query engine, but this needs a lot of work to improve performance.

Historical design document follows:

<hr>

The aim is to define a way to represent a selection of the JSONTag dataspace in a string. For JSON there are JSON Path and JSON Pointer. For HTML there is the CSS selector. JSONTag has properties of both HTML and JSON, so a mix of these is a logical solution.

What must the JSONTag selector be capable of?

- point to a single entity inside a JSONTag dataset
- select multiple entities with something similar
- combine two or more selectors

In addition the selector must be usable within a graphql-like query syntax.

## CSS Selectors and JSONTag data

We have some experience with this, using the [JSON-CSS](https://github.com/simplyedit/json-css) library. This works reasonably well, but mostly because browsers have built-in CSS selector support that is highly optimized. Still let's see what JSONTag-selector would look like if it was just a CSS Selector.

The JSONTag data would need to be converted to an XML structure that contains all data. The problem here is that JSONTag already contains tags, that would need to be converted somehow. This may actually be simpler than just JSON data, because we have tags for all types already.

Given:
```jsontag
[
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18"
	}
]
```

This becomes:
```xml
<array>
	<object class="Task" key="0">
		<string key="title" value="This is a task" />
		<date key="start" value="2023-01-18" />
	</object>
</array>
```

The only issue here is that there may be a conflict between attributes on the JSONTag tags, and attributes used to encode JSONTag values into XML attributes. This is solvable by introducing a namespace:

```xml
<array>
	<object class="Task" js-key="0">
		<string js-key="title" js-value="This is a task" />
		<date js-key="start" js-value="2023-01-18" />
	</object>
</array>
```

The `-` is illegal in JSONTag, so this will never conflict.

To query all tasks with a date after 2023-01-01, you could write this selector:

```css
.Task:has(> date[js-key="start"][js-value^="2023-01-"])
```

The problems with this approach are, among others:
- you can only query tags and attributes, so all values must be encoded in attributes
- you can only use text-like comparisons, there is no `attribute value is greater than` comparison, for example. There are no ranges.
- the syntax is a bit cumbersome, although it could be improved by a simple compilation. The above syntax could be simplyfied to:

```css
.Task:has(> date[start^="2023-01-"])
```

The advantages are that there is a wealth of optimized code to apply CSS selectors to XML data, and CSS selectors are relatively well understood and documented.


## JSONPath and JSONTag data

JSONPath is a complete query and filter language for JSON data. However it is also fairly complex and cumbersome. The same query as above would be something like:

```jsonpath
$[?(@.start>'2023-01-01')]
```

There is no support for tag names or attributes, because JSON doesn't support those. So this needs to be added. One way is to encode these inside the JSON data, similar to what JSON-LD does. The JSON version of the JSONTag data then becomes:

```json
[
	{
		"_class": "Task",
		"_tag": "object",
		"title": "This is a task",
		"start": {
			"_tag": "date",
			"_value": "2023-01-18"
		}
	}
]
```

This is not ideal or consistent. I haven't converted the `title` value to an object, but have done so for the `start` value. There is probably a better encoding, but this shows the gist of it. The JSONPath selector now becomes:

```jsonpath
$[?(@._class='Task' && @.start._value>'2023-01-01')]
```

But the ideal solution would be to just extend the JSONPath language with tag and attribute query support and use the JSONTag data directly.

See [JSONPath-plus](https://github.com/JSONPath-Plus/JSONPath) for a promising code base that has the potential to be extended for JSONTag.

## GraphQL

GraphQL not only allows for querying, but also mutations. Here we just consider the query syntax. Given the same data and selection, here's what this would look like in a GraphQL query:

```
Task(filter:{start:{greaterThen:"2023-01-01"}) {
	title
	start
}
```

This is not entirely accurate, but will do for this purpose. The advantage of Graphql is that it allows you to specify the properties you are interested in, including properties of linked objects. This solves the problem of having to query a server many times to complete a dataset that contains links.

For example, if we add assigned persons to a task, the dataset might look like this:

```jsontag
[
	<object class="Person" id="john">{
		"name": "John",
		"dob": <date>"1972-09-20"
	},
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18",
		"assigned": [
			<link>"#john"
		]
	}
]
```

Then you could write this query:

```
Task(filter:{start:{greaterThen:"2023-01-01"}) {
	title
	start
	assigned {
		name
	}
}
```

And the result should be:

```
[
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18",
		"assigned": [
			<object class="Person" id="john">{
				"name": "John"
			}
		]
	}	
]
```

The interesting part here is, whether the graphql query/filter syntax is the best fit, or perhaps can we replace that with the CSS selector or JSON Path? GraphQL is not quite designed for the purpose here, but I like the way you can select which data to return. The filter options are limited and non-standardized. Each graphql server has its own filter syntax and options. I also don't like the way the filter syntax is articifially limited to something that looks like JSON. I do like the focus on words instead of symbols to denote filter options and functions.

GraphQL also allows you to specify aliases for resulting data, so instead of assigned you could write:

```
Task(filter:{start:{greaterThen:"2023-01-01"}) {
	title
	start
	owner:assigned {
		name
	}
}
```

```
[
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18",
		"owner": [
			<object class="Person">{
				"name": "John"
			}
		]
	}	
]
```

There is more you can do with aliases, but I'm not sure that this is an approach to copy. The main use for aliases is to prevent conflicts in result names.

The main problem I see with the query syntax is that if I just want all the assigned persons, I'd query this way:

```
Task(filter:{start:{greaterThen:"2023-01-01"}) {
	title
	start
	assigned
}
```

But as it stands this would result in:

```
[
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18",
		"assigned": [
			<link>"/0/"
		]
	}	
]
```

This requires extra queries again, which is precisely what we want to avoid.
For this reason, the JSONTag Rest server always resolves arrays and literal values (strings, numbers and booleans). So the result should be:

```
[
	<object class="Task">{
		"title": "This is a task",
		"start": <date>"2023-01-18",
		"assigned": [
			<object class="Person">{
				"name": "John",
				"dob": <date>"1972-09-20"
			}
		]
	}	
]
```

This does break the GrapQL paradigm where you will only ever get the exact properties that you request.

## -Current approach- past approach

For now I'm using [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath) which extends the default [JSONPath]() with among others a parent selector. This codebase looks relatively simple to add tagname and attribute selection support. This implementation allows for javascript methods to be called in filters, applied only to available data. The expressions are evaluated in a seperate 'vm', but security needs to be checked carefully.

You can query the dataset by POSTing to a path, with the JSON Path query in the body. e.g.:

```
POST /persons/

$[?(@.name==='Jane')]
```

This will result in:

```jsontag
[
    <object class="Person">{
        "name":"Jane",
        "dob":<date>"1986-01-01"
    }
]
```

The next step is to add a bit of GraphQL syntax to describe which properties you want returned. e.g.

```
$.[?(@.name==='Jane')] {
	name
}
```

Add alias support, so you can rename properties:

```
$.[?(@.name==='Jane')] {
	foo:name
}
```

And finally add subqueries, where you can assign JSON Path search results to a property:

```
$.[?(@.name==='Jane')] {
	name
	tasks:$$..tasks[?(@.assigned==='Jane')]
}
```

A problem here is whether the subquery should start at the global root, or the current object. The global root allows for much more features, but also adds complexity. It would be nice to be able to specify in the query, e.g. make the global root something like $$.

JSON Path has no knowledge of JSONTag, so it has no support for tag names (types) or attributes. JSON Path uses these special characters already: `$.@?&=!<>*`. Lets use `#` for attributes, like `@` for properties. You could then do this:

```
$.[?(#.class==='Person')] {
	name
}
```

And we can add a tag name, like this:

```
$.[?(#.class==='Person' && #.tag-name==='object')] {
	name
}
```

By using 'tag-name' we are sure it will never conflict with an attribute name, since they can't contain `-`.

## New Current Approach

After reading [Datalog in Javascript](https://www.instantdb.com/essays/datalogjs) I've switched the query engine to Datalog. In fact the query engine is a javascript interpreter running in [VM2](https://github.com/patriksimek/vm2), with access to the query function of the triple store compiled from the jsontag input data.

So you can now POST to the /query endpoint with just a simple query:

```javascript
query({
	find: ["?name"],
	where: [
		["?person", "dob", "1972-09-20"],
		["?person", "name", "?name"]
	]
})
```

And the result will be:
```
[
	["John"]
]
```

Or you can add your own function to match values:

```javascript
function lessThan(pattern) {
	return function(match) {
		if (match<pattern) {
			return match
		}
		return null
	}
}

query({
	find: ["?name"],
	where: [
		["?person", "dob", lessThan("1980")],
		["?person", "name", "?name"]
	]
})
```

You can also return complete objects:
```javascript
query({
	find: ["?person"],
	where: [
		["?person", "dob", lessThan("1980")]
	]
})
```

There is as yet no way to transform the result, other than adding your own bespoke javascript to do that.
