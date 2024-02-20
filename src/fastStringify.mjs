import JSONTag from '@muze-nl/jsontag';
import {source,isProxy,getIndex, getBuffer} from './symbols.mjs'

// faststringify function for a fast parseable arraybuffer output
// 
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export default function stringify(value, meta, skipLength=false, index=false) {
	let resultArray = []
	if (!meta) {
		meta = {}
	}
	if (!meta.index) {
		meta.index = {}
	}
	if (!meta.index.id) {
		meta.index.id = new Map()
	}
	let references = new WeakMap()

	function stringifyValue(value) {
		let prop
		let typeString = JSONTag.getTypeString(value)
		let type = JSONTag.getType(value)
		switch (type) {
			case 'string':
			case 'decimal':
			case 'money':
			case 'link':
			case 'text':
			case 'blob':
			case 'color':
			case 'email':
			case 'hash':
			case 'duration':
			case 'phone':
			case 'url':
			case 'uuid':
			case 'date':
			case 'time':
			case 'datetime':
				if (JSONTag.isNull(value)) {
					value = 'null'
				} else {
					value = JSON.stringify(''+value)
				}
				prop = typeString + value
			break
			case 'int':
			case 'uint':
			case 'int8':
			case 'uint8':
			case 'int16':
			case 'uint16':
			case 'int32':
			case 'uint32':
			case 'int64':
			case 'uint64':
			case 'float':
			case 'float32':
			case 'float64':
			case 'timestamp':
			case 'number':
			case 'boolean':
				if (JSONTag.isNull(value)) {
					value = 'null'
				} else {
					value = JSON.stringify(value)
				}
				prop = typeString + value
			break
			case 'array': 
				let entries = value.map(e => stringifyValue(e)).join(',')
				prop = typeString + '[' + entries + ']'
			break
			case 'object':
				if (!value) {
					prop = 'null'
				} else if (value[isProxy]) {
					prop = decoder.decode(value[getBuffer](current))
				} else {
					if (!references.has(value)) {
						references.set(value, resultArray.length)
						resultArray.push(value)
					}
					prop = '~'+references.get(value)
				}
			break
			default:
				throw new Error(JSONTag.getType(value)+' type not yet implemented')
			break
		}
		return prop
	}

	const encoder = new TextEncoder()
	const decoder = new TextDecoder()

	// is only ever called on object values
	// and should always return a stringified object, not a reference (~n)
	const innerStringify = (current) => {
		let indent = ""
		let gap = ""

		if (typeof space === "number") {
			indent += " ".repeat(space)
		} else if (typeof space === "string") {
			indent = space
		}

		let object = resultArray[current]
		let result 

		// if value is a valueProxy, just copy the input slice
		if (object && !JSONTag.isNull(object) && object[isProxy]) {
			return decoder.decode(object[getBuffer](current))
		}
		if (typeof object === 'undefined' || object === null) {
			return 'null'
		}
		
		let props = []
		for (let key of Object.getOwnPropertyNames(object)) {
			let value = object[key]
			let prop = stringifyValue(value)
			let enumerable = object.propertyIsEnumerable(key) ? '' : '#'
			props.push(enumerable+'"'+key+'":'+prop)
		}
		result = JSONTag.getTypeString(object)+'{'+props.join(',')+'}'
		return result
	}
		
	const encode = (s) => {
		if (skipLength) {
			return s
		}
		let length = new Blob([s]).size
		return '('+length+')'+s
	}

	resultArray.push(value)
	let current = 0
	while(current<resultArray.length) {
		resultArray[current] = innerStringify(current)
		current++
	}

	return resultArray.map(encode).join("\n")
}

export function stringToSAB(strData) {
	const buffer = encoder.encode(strData)
	const sab = new SharedArrayBuffer(buffer.length)
	let uint8sab = new Uint8Array(sab)
	uint8sab.set(buffer,0)
	return uint8sab
}

export function resultSetStringify(resultSet) {
	return resultSet.map((e,i) => {
		let buffer = e[getBuffer](i)
		return '('+buffer.length+')'+decoder.decode(buffer)
	}).join("\n")
}