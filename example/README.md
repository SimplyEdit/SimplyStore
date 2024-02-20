# SimplyStore Example

## Setup

```shell
npm install
```

Then convert the dataset `swdb.jsontag` to internal SimplyStore format:

```shell
node ../scripts/convert.mjs swdb.jsontag data.jsontag
```

Then start the server:
```shell
npm start
```

Now go to `https://localhost:3000/query/` and you can enter queries, e.g.:

```javascript
from(data.people)
.select({
	name: _
})
```

Press Ctrl-Enter to run, or use the run button.

This example uses information from the Star Wars API project: `https://swapi.dev/`
