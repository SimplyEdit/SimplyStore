import { v4 as uuid } from 'uuid'
// run command to localhost:3000

const id = uuid()
let timestamp = new Date().toISOString()
timestamp = timestamp.substring(0, timestamp.indexOf('T'))
const commandStr = `{
    "id": "${id}",
    "name": "addPerson",
    "timestamp": <date>"${timestamp}",
    "author":"someone",
    "value": <object id="/uuid/${id}">{
        "name": "Dave the Stormtrooper",
        "gender": "male",
        "homeworld": <link>"http://swapi.co/api/planets/1/"
    }
}`

async function main() {
    const response = await fetch('http://localhost:3000/command', {
        method: 'POST',
        headers: {
            'Accept': 'application/jsontag',
            'Content-Type': 'application/jsontag'
        },
        body: commandStr
    })
    if (!response.ok) {
        const text = await response.text()
        const status = response.status + ': ' + response.statusText
        console.error(status, text)
    }
    else {
        const data = await response.json()
        console.log('response:', data)
    }
}

await main()
