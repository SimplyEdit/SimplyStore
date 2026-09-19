# SimplyStore Example

## Setup

```shell
npm install
```

Then convert the dataset `swdb.jsontag` to internal SimplyStore format:

```shell
npm run build
```

This creates `data.jsontag`, its indexes, and empty command and status logs
for the first startup. Build requires a new store and refuses to overwrite
existing data or logs. Run it once before starting the example.

Then start the server:
```shell
npm start
```

Now go to `http://localhost:3000/query/` and you can enter queries, e.g.:

```javascript
from(data.people)
.select({
	name: _
})
```

Press Ctrl-Enter to run, or use the run button.

This example uses information from the Star Wars API project: `https://swapi.dev/`, in the format provided by `https://github.com/fgeorges/star-wars-dataset`. To update the data clone this repository into `example/star-wars-dataset/` and then run this command:

```shell
> cd example/
> node ./combine.mjs > swdb.jsontag
```
