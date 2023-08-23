import JSONTag from '@muze-nl/jsontag'

const handler = function(root, index, buffer) 
{
	return {
		get(target, key, receiver) 
		{
			let keyNumber = index.key[key]
			if (root[keyNumber]) {
				let keyStart = root[keyNumber].s + root.s
				let keyEnd = root[keyNumber].e + root.s
				subobjecten hoeven niet geparsed...
				if (root[keyNumber].c) {
					// object
					return new jsontagProxy(root[keyNumber], index, buffer)
				}
				return JSON.parse(buffer.slice(keyStart,keyEnd))
			}
		}

		has(target, key)
		{
			let keyNumber = index.key[key]
			return typeof root[keyNumber] !== 'undefined'
		}

		ownKeys(target)
		{
			return root.c.map(n => index.reverse[n])
		}
	}
}

export class jsontagProxy extends proxy
{
	constructor(root, index, buffer) 
	{
		super({}, handler(root, index, buffer))
	}

}

export default function share(data)
{
	let jsontag = JSONTag.stringify(data)
	let buffer = new SharedArrayBuffer(jsontag.length)
	let dv = new DataView(buffer)
	let encode = new TextEncoder('utf-8')
	let root = {}
	let index = {
		key: {},
		reverse: [],
		types: {}
	}
	let current = 0

	function getKey(key) {
		let l;
		if (typeof index.key[key] == 'undefined') {
			l = Object.keys(index.key)
			index.key[key] = l
			index.reverse[l] = key
		}
		return index.key[key]
	}

	function getType(type) {
		if (typeof index.types[type] == 'undefined') {
			l = Object.keys(index.types);
			index.types[type] = l
		}

	}

	function store(container, key, value) {
		let l = getKey(key)
		container[l] = {
			s: current
		}
		container = container[l]
		let attributes = JSONTag.getAttributes(value)
		if (attributes) {
			container.a = {
				s: current,
				c: {}
			}
			attributes.forEach((v,k) => {
				let l = getKey(k)
				let t = getType('string')
				container.a.c[k] = {
					s: current,
					t
				}
				let v = JSON.stringify(value)
				let (r,w) = encoder.encodeInto(v, dv, current)
				current += w
				container.a.c[k].e = current
			})
		}
		let type = JSONTag.getType(node)
		let t = getType(type)
		container.t = t
		let v = JSON.stringify(value)
		let (r,w) = encoder.encodeInto(v, dv, current)
		current+= w
		container.e = current
	}


	function walk(node, parentKey, parent, save) 
	{
		let type = JSONTag.getType(node)
		let t = getType(type)
		switch (type) {
			case 'array':
				save.s = current
				save.t = t
				save.c = []
				node.forEach((v,k) => walk(v, k, node, save.c))
				save.e = current
				break
			case 'object':
				save.s = current
				save.c = []
				save.t = t
				Object.entries(node).forEach((k,v) => walk(v, k, node, save.c))
				save.e = current
				break
			default:
				store(save, parentKey, node)
				break
		}
	}

	walk(data, null, null, root)

	return {
		root: new jsontagProxy(root, index, buffer),
		index,
		buffer
	}
}