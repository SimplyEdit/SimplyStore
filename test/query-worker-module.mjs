import tap from 'tap'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import tasks from '../src/query-worker-module.mjs'

tap.test('query worker executes JavaScript against a cyclical SharedArrayBuffer dataspace', async t => {
	const input = {
		persons: []
	}
	const ada = { name: 'Ada' }
	ada.self = ada
	input.persons.push(ada)

	const initTask = {
		req: {
			body: [serialize(input)],
			meta: {
				index: { id: new Map() }
			}
		}
	}
	await tasks.init(initTask)

	const queryTask = {
		req: {
			path: '/',
			body: `(data.persons[0].self === data.persons[0] && data.persons[0].name === 'Ada')`,
			jsontag: false
		},
		timeout: 1000
	}

	const response = await tasks.query(queryTask)
	const body = JSON.parse(response.body)

	t.equal(body, true)
	t.equal(response.code, undefined)
	t.end()
})
