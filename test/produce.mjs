/*
import tap from 'tap'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import {produce,index} from '../src/produce.mjs'
import {deepFreeze} from '../src/util.mjs'

let data = deepFreeze(JSONTag.parse(fs.readFileSync('./test/test.jsontag','utf-8')))

tap.test('data is frozen', t => {
	t.throws(() => {
		data.persons.foo = 'bar'
	})
	t.notHas(data.persons, {foo:'bar'})
	t.end()
})

tap.test('produce can create new data', t => {
	let newData = produce(data, (draft) => {
		draft.persons.foo = 'bar'
	})
	t.has(newData.persons, {foo:'bar'})
	t.end()
})

tap.test('produce does not change base data', t => {
	let newData = produce(data, (draft) => {
		console.log('Persons draft',draft.persons, Object.isFrozen(draft.persons))
		draft.persons.foo = 'bar'
	})
	t.notHas(data.persons, {foo:'bar'})
	t.end()	
})

tap.test('produce handles array access', t => {
	let newData = produce(data, (draft) => {
		draft.persons[0].name = 'Jan'
	})
	t.equal(newData.persons[0].name, 'Jan')
	t.end()
})

tap.test('produce handles array functions', t => {
	let newData = produce(data, (draft) => {
		draft.persons.push({
			name: 'Jan'
		})
	})
	t.equal(newData.persons[2].name, 'Jan')
	t.same(data.persons[2],null)
	t.end()
})

tap.test('produce can use array.indexOf inside', t => {
	let newData = produce(data, (draft) => {
		let p = draft.persons[1] // this returns a proxy
		let i = draft.persons.indexOf(p) // this is passed on to the baseState/clone, which has values without proxy
		t.equal(i,1) // so this no longer fails, as indexOf automatically calls getRealValue on all params
	})
	t.end()
})

tap.test('produce does not alter unaccessed objects', t => {
	let newData = produce(data, (draft) => {
		draft.persons.foo = 'bar'
	})
	t.equal(data.persons[0],newData.persons[0])
	t.equal(data.persons[1],newData.persons[1])
	t.notEqual(data.persons,newData.persons)
	t.end()
})

tap.test('proxies get re-used', t => {
	let newData = produce(data, (draft) => {
		let p1 = draft.persons[0]
		let p2 = draft.persons[0]
		t.equal(p1,p2)
	})
	t.end()
})
*/