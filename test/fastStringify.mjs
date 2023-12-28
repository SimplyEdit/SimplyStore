import JSONTag from '@muze-nl/jsontag'
import stringify from '../src/fastStringify.mjs'
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
	let s = stringify(o,null,4)
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