# SimplyStore Queries

SimplyStore uses javascript as its query engine. This means that you can write any traditional javascript to search through the dataspace. However, this can get quite complex quickly. So SimplyStore adds a more convenient javascript library that mimics how GraphQL works. Just in javascript. This document is a relatively short manual. The full documentation can be found at the [JAQT library github repository](https://github.com/muze-nl/jaqt/blob/main/docs/manual.md)

- [Select](#select)
- [Aliases](#aliases)
- [Fragments](#fragments)
- [Functions](#functions)
- [Filtering with Where()](#where)
- [Request parameters](#request)
- [Paginating results](#paginating)
- [Sorting with orderBy()](#orderBy)
- [Grouping with groupBy()](#groupBy)
- [Default values](#defaults)
- [Array functions](#array-functions)
- [Conditional execution](#conditional)
- [Indexes](#indexes)

<a name="select"></a>
## select

The SimplyStore example dataspace contains some information from the Star Wars movies, e.g.

```javascript=
from(data.people)
.select({
    name: _
})
```
Returns:

```jsontag
[
    {
        "name":<text>"Luke Skywalker"
    },
    {
        "name":<text>"C-3PO"
    },
    {
        "name":<text>"R2-D2"
    },
    ...
]
```

The equivalent GraphQL query would be:

```GraphQL
query People {
    people {
        name
    }
}
```

Or to see in which movies each character appears, the query would be:

```javascript=
from(data.people)
.select({
  name: _,
  films: {
    title: _
  }
})
```

With the following result:

```jsontag
[
    {
        "name":<text>"Luke Skywalker",
        "films":[
            {
                "title":<text>"Revenge of the Sith"
            },
            {
                "title":<text>"Return of the Jedi"
            },
            {
                "title":<text>"The Empire Strikes Back"
            },
            {
                "title":<text>"A New Hope"
            },
            {
                "title":<text>"The Force Awakens"
            }
        ]
    },
    ...
]
```

The equivalent GraphQL query would be:

```GraphQL
query PeopleAndFilms {
    people {
        name
        films {
            title
        }
    }
}
```

<a name="aliases"></a>
## Aliases

You can also use aliases:

```javascript=
from(data.people)
.select({
    fullName: _.name
})
```
The equivalent GraphQL query:

```GraphQL=
query PeopleAndFilms {
    people {
        fullName: name 
    }
}
```

<a name="fragments"></a>
## Fragments

And you can re-use fragments:

```javascript=
const names = {
    name: _,
    title: _
}

from(data.people)
.select({
    ...names,
    films: {
        ...names
    }
})
```

With the equivalent GraphQL query:

```GraphQL=
fragment names on People {
    name
}
fragment names on Films {
    title
}
query PeopleAndFilms {
    people {
        ...names
        films {
            ..names
        }
    }
}
```

<a name="functions"></a>
## Functions

The queries are still just javascript, so instead of the `_` value, we can add a function:

```javascript=
from(data.people)
.select({
    info: o => o.name+' ('+o.gender+')' 
})
```

Resulting in:

```json
[
    {
        "info":"Luke Skywalker (male)"
    },
    {
        "info":"C-3PO (n/a)"
    },
    {
        "info":"R2-D2 (n/a)"
    },
    {
        "info":"Darth Vader (male)"
    },
    ...
]
```

GraphQL doesn't allow you to write your own functions in the query, so there is no equivalent GraphQL query.

<a name="where"></a>
## Filtering with Where()

You can filter results like this:

```javascript=
from(data.people)
.where({
    films: {
        title: "A New Hope"
    }
})
.select({
    name: _
})
```

And the result is:
```jsontag
[
    {
        "name":<text>"Luke Skywalker"
    },
    {
        "name":<text>"C-3PO"
    },
    {
        "name":<text>"R2-D2"
    },
    {
        "name":<text>"Darth Vader"
    },
    ...
]
 ```
 
In GraphQL you would have to have a prepared query or reducer that allows you to filter on a film title. In that case the query would probably look like this:
 
 ```GraphQL
query PeopleByFilm($film: Film) {
     people(film: $film) {
         name
     }
 }
 ```
 
But you cannot filter on any property, just the ones for which support has been added to the GraphQL server.

<a name="request"></a>
## Request parameters

The GraphQL query above adds an important feature: you can define the query once and then call it with different variables. You can do the same in SimplyStore, like this:

```javascript=
from(data.people)
.where({
    films: {
        title: request.query.film
    }
})
.select({
    name: _
})
```

And then call the SimplyStore query endpoint with this query and the url query string `?film=A+New+Hope`.

<a name="paginating"></a>
## Paginating results</a>

When you have a lot of results, it is often better to return a subset of all results. There are many strategies on how to do this. SimplyStore does not force you to use a specific one, you can build any pagination strategy you want. 

Here is an example with fixed page sizes:
```javascript=
const PageSize = parseInt(request.query.pageSize) || 10
const Page = parseInt(request.query.page) || 0
const Paging = {
    start: Page*PageSize,
    end: (Page+1)*PageSize-1
}
function Paginate(results) {
    let meta = {
        count: results.length,
        data: results.slice(Paging.start,Paging.end)
    }
    if (Paging.end<results.length) {
        meta.next = new JSONTag.Link('?page='+(Page+1)+'&pageSize='+PageSize)
    }
    if (Paging.start>0) {
        meta.prev = new JSONTag.Link('?page='+(Page-1)+'&pageSize='+PageSize)
    }
    return meta
}

const results = from(data.people)
.select({
    name: _
})

Paginate(results)
```

This will result in:
```jsontag
{
    "count":87,
    "data":[
        {
            "name":<text>"Anakin Skywalker"
        },
        {
            "name":<text>"Wilhuff Tarkin"
        },
        ... contents cut
        {
            "name":<text>"Jek Tono Porkins"
        },
        {
            "name":<text>"Yoda"
        }
    ],
    "next":<link>"?page=2&pageSize=10",
    "prev":<link>"?page=0&pageSize=10"
}
```

<a name="fixtures"></a>
## Fixtures

The query above is getting rather complex. This is not a problem when you are writing a javascript client. You can just prepend common used fragments to the query, like this:

```javascript=
const fragments = `
const PageSize = parseInt(request.query.pageSize) || 10
const Page = parseInt(request.query.page) || 0
const Paging = {
    start: Page*PageSize,
    end: (Page+1)*PageSize-1
}
function Paginate(results) {
    // contents cut, see function above
}`
const query = 'Paginate(from(data.people).select({name:_}))'
simplyStoreApi.query(fragments+';'+query)
```

But if you are using the SimplyStore /query/ user interface, you can get the same effect by loading the 'Fixtures' query. The contents of this query will be prepended automatically to every query you send using SimplyStores query user interface.


<a name="sorting"></a>
## Sort results with orderBy()

You can order results by one or more properties, like this:

```javascript=
from(data.people)
.orderBy({
  homeworld: {
    gravity: asc
  },
  name: asc
})
.select({
  name: _,
  homeworld: {
    gravity: _
  }
})
```

Which gives this result:

```json
[
    {
        "name":<text>"Bossk",
        "homeworld":{
            "gravity":"0.62 standard"
        }
    },
    {
        "name":<text>"Wicket Systri Warrick",
        "homeworld":{
            "gravity":"0.85 standard"
        }
    },
    ...
]
```

orderBy() sorts on the properties in the order given. Only if an earlier sort property is equal, will the next property be compared.

orderBy() can be added before or after the select() clause. If you add it before, you can sort on fields that aren't part of the result set.

The corresponding GraphQL query depends on which GraphQL engine you are using. But usually it would be:

```GraphQL=
query People {
  people(order_by:{home_world:{gravity:asc},name:asc}) {
    name
    home_world {
      gravity
    }
  }
}
```

<a name="groupBy"></a>
## Grouping with groupBy

Note: _This function is still very experimental and likely to change._

You can group results by distinct field values, like this:

```javascript=
from(data.people)
.groupBy({
    films: {
        title: _.name
    }
})
```

Which results in:
```json
{
    "Revenge of the Sith":[
        "Luke Skywalker",
        "C-3PO",
        "R2-D2",
        ...
    ],
    "Return of the Jedi":[
        "Luke Skywalker",
        "C-3PO",
        "R2-D2",
        ...
    ],
    ...
}

```

In addition, you can also use the SQL-like functions `count()`,`sum()`,`avg()`,`min()` and `max()`. Of these `count()` will work on any value. The others need number values.

```javascript=
from(data.people)
.groupBy({
  films: {
    title: count()
  }
})
```

Results in:
```json
{
    "Revenge of the Sith":34,
    "Return of the Jedi":20,
    "The Empire Strikes Back":16,
    "A New Hope":18,
    "The Force Awakens":11,
    "Attack of the Clones":40,
    "The Phantom Menace":34
}
```

<a name="defaults"></a>
## Default values

Default values are supported as well, like this:

```javascript=
from(data.people)
.where({
    films: {
        title: request.query.film || "A New Hope"
    }
})
.select({
    name: _
})
```
<a name="array-functions"></a>
## Array functions

The result of the from() and from().where() functions behave like arrays--unless you use from() on an object. This means that you can also use all the array functions from javascript, like filter(), map(), reduce(), sort(), etc:

```javascript=
from(data.people)
.filter(p => p.name=="Luke Skywalker")
.select({
    films: {
        title: _
    }
})
```

```javascript=
from(data.people)
.select({
    name: _
})
.sort((a,b) => a.name<b.name ? -1 : 1)
```

<a name="conditional"></a>
## Conditional execution

GraphQL supports something called Directives. E.g.

```GraphQL
query People($film: Film, $withFilms: Boolean) {
    People(film: $film) {
        name
        films @include(if: $withFilms) {
            title
        }
    }
}
```

SimplyStore queries are just javascript. So you can achieve the same effect like this:

```javascript=
let fields = {
    name: _
}
if (request.query.withFilms) {
    fields.films = { name: _ }
}
from(data.people)
.select(fields)
```

<a name="indexes"></a>
## Indexes

GraphQL systems usually add indexes, based on the parameters built into the reducers. SimplyStore has no default indexes, except for the `id` index. Each object with a JSONTag `id` attribute, is added to this index. You can access the index like this:

```javascript=
function Index(id) {
    return meta.index.id.get(id)?.deref()
}
```

And then use it in your queries like this:

```javascript=
from(Index(request.query.id))
.select({
    name: _,
    title: _
})
```

Since people have names and films have titles, I've just added both in the select fields. SimplyStore will automatically omit and fields that aren't in the dataset. You won't get errors are warnings here, so be careful about typo's.

