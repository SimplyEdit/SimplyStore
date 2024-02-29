import { v4 as uuid } from 'uuid'
import JSONTag from '@muze-nl/jsontag'

// run command to localhost:3000

let id = uuid()
let commandStr = `{
	"id": "${id}",
	"name": "addUnknown",
	"value": {
		"name": "Some Stormtrooper",
		"gender": "male",
		"homeworld": <link>"http://swapi.co/api/planets/1/"
	}
}`


async function main() {
	let response = await fetch('http://localhost:3000/command', {
		method: 'POST',
		headers: {
			'Accept': 'application/jsontag',
			'Content-Type': 'application/jsontag'
		},
		body: commandStr
	})
	if (!response.ok) {
		let text = await response.text()
		console.error(response.status+': '+response.statusText, text)
	} else {
		let data = await response.json()
		console.log('response:', data)
	}
}

main()