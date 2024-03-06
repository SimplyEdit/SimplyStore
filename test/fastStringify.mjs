import JSONTag from '@muze-nl/jsontag'
import stringify, {resultSetStringify,stringToSAB} from '../src/fastStringify.mjs'
import {isChanged, getBuffer, getIndex} from '../src/symbols.mjs'
import parse from '../src/fastParse.mjs'
import tap from 'tap'

const decoder = new TextDecoder()
const encoder = new TextEncoder()


tap.test('Links', t => {
 	let jsont=`{
    "foo":[
        <object class="foo" id="1">{
            "name":"Foo"
        }
    ],
    "bar":[
        <object class="bar" id="2">{
            "name":"Bar",
            "children":[
                <link>"1"
            ]
        }
    ]
}`
	let expect = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let o = JSONTag.parse(jsont);
	Object.defineProperty(o.foo[0], 'nonEnumerable', {
		value: 'bar',
		enumerable: false
	})
	let s = stringify(o)
	t.equal(expect, s)
	t.end()
})

tap.test('Parse', t => {
	let s = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let l = new Blob([s]).size
	let b = new SharedArrayBuffer(l)
	let u = new Uint8Array(b)
	let encoder = new TextEncoder()
	let a = encoder.encodeInto(s, u)
	let result = parse(u)
	t.equal(result[1].name, 'Foo')
	t.equal(result[0].foo[0], result[1])
	t.end()
})

tap.test('fastParse', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let sab = stringToSAB(strData)
	let resultSet = parse(sab)
	t.equal(resultSet[1].name, 'Foo')
	t.equal(resultSet[2].name, 'Bar')
	t.end()
})

tap.test('immutable', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let sab = stringToSAB(strData)
	let resultSet = parse(sab, {}, true) // immutable
	let root = resultSet[0]
	try {
		root.foo[0].name='Baz'
		t.ok(false)
	} catch(e) {
		t.ok(true)
	}
	t.equal(root.foo[0].name, 'Foo')
	t.equal(resultSet[1].name, 'Foo')
	t.end()
})

tap.test('update', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let expect = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Baz",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	
	let sab = stringToSAB(strData)
	let resultSet = parse(sab, {}, false)
	let root = resultSet[0]
	root.foo[0].name='Baz'
	t.equal(root.foo[0].name, 'Baz')
	t.equal(resultSet[1].name, 'Baz')
	strData = resultSetStringify(resultSet)
	t.equal(strData, expect)
	t.end()

})

tap.test('append', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let expect = `(26){"foo":[~1,~3],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}
(30){"name":"Baz","children":[~1]}`
	
	let sab = stringToSAB(strData)
	let resultSet = parse(sab, {}, false)
	let root = resultSet[0]
	root.foo.push({
		name: 'Baz',
		children: [
			root.foo[0]
		]
	})
	strData = resultSetStringify(resultSet)
	t.equal(strData, expect)
	t.end()

})

tap.test('appendChild', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let expect = `(26){"foo":[~1,~3],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}
(30){"name":"Baz","children":[~4]}
(16){"name":"Child"}`
	
	let sab = stringToSAB(strData)
	let resultSet = parse(sab, {}, false)
	let root = resultSet[0]
	root.foo.push({
		name: 'Baz',
		children: [
			{
				name: 'Child'				
			}
		]
	})
	strData = resultSetStringify(resultSet)
	t.equal(strData, expect)
	t.end()

})

tap.test('delete', t => {
	let strData = `(23){"foo":[~1],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	let expect = `(21){"foo":[],"bar":[~2]}
(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}
(57)<object class="bar" id="2">{"name":"Bar","children":[~1]}`
	
	let sab = stringToSAB(strData)
	let resultSet = parse(sab, {}, false)
	let root = resultSet[0]
	root.foo.pop()
	strData = resultSetStringify(resultSet)
	t.equal(root.foo[isChanged], true)
	t.equal(strData, expect)
	t.end()

})

tap.test('circular', t => {
	let strData =`{
	"foo":[
		<object id="1">{"name":"Foo","children":[<link>"2"]}
	],"bar":[
		<object id="2">{"name":"Bar","children":[<link>"1"]}
	]
}`
	let expect = `(23){"foo":[~1],"bar":[~2]}
(45)<object id="1">{"name":"Foo","children":[~2]}
(45)<object id="2">{"name":"Bar","children":[~1]}`
	let data = JSONTag.parse(strData)
	let result = stringify(data)
	t.equal(result,expect)
	t.end()
})


tap.test('encoding', t => {
	let strData = `(24){"name":"Padmé Amidala"}`
	let sab = stringToSAB(strData)
	let resultSet = parse(sab)
	let padme = resultSet[0]
	t.equal(padme.name, "Padmé Amidala")
	t.end()
})

tap.test('entries', t => {
	let strData = `(64)<object class="foo" id="1">{"name":"Foo",#"nonEnumerable":"bar"}	`
	let sab = stringToSAB(strData)
	let resultSet = parse(sab)
	let root = resultSet[0]
	let keys = Object.keys(root)
	t.same(keys, ['name'])
	let ownKeys = Object.getOwnPropertyNames(root)
	t.same(ownKeys, ['name','nonEnumerable'])
	let descr = Object.getOwnPropertyDescriptor(root, 'nonEnumerable')
	t.equal(descr.enumerable, false)
	t.end()
})


tap.test('unicode', t => {
	let strData = `(13){"foo":"𠮷a"}` // >16bit unicode characters 
	let sab = stringToSAB(strData)
	let resultSet = parse(sab)
	let root = resultSet[0]
	t.equal(root.foo, '𠮷a')
	t.end()
})