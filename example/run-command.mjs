import { v4 as uuid } from 'uuid'
import JSONTag from '@muze-nl/jsontag'

// run command to localhost:3000

let command = {
	id: uuid(),
	name: 'addPerson',
	value: {
		name: 'Some Stormtrooper',
		gender: 'male',
		homeworld: new JSONTag.Link("http://swapi.co/api/planets/1/")
	}
}

async function main() {
	let response = await fetch('http://localhost:3000/command', {
		method: 'POST',
		headers: {
			'Accept': 'application/jsontag',
			'Content-Type': 'application/jsontag'
		},
		body: JSONTag.stringify(command)	
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