import JSONTag from '@muze-nl/jsontag'
import stringify, {resultSetStringify,stringToSAB} from '../src/fastStringify.mjs'
import parse from '../src/fastParse.mjs'
import tap from 'tap'


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
	let resultSet = parse(sab, {}, true) // imutable
	let root = resultSet[0]
	root.foo[0].name='Baz'
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
	t.equal(expect, strData)
	t.end()

})