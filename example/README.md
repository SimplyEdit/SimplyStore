# SimplyStore Example

## Setup

```shell
npm install
```

Then convert the dataset `swdb.jsontag` to internal SimplyStore format:

```shell
npm run build
```

This creates `data.jsontag`, its indexes, `data.integrity.jsontag`, and empty
command and status logs
for the first startup. Build requires a new store and refuses to overwrite
existing data or logs. Run it once before starting the example.

If you already have an example store from before integrity became mandatory,
stop its server and initialize hashes once, preserving its existing commands:

```shell
npm run init-integrity
```

This validates the current files and creates the missing manifest. It refuses to
replace an existing manifest or initialize an uncertain/inconsistent store. New
stores created with `npm run build` do not need this step.

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
