import JSONTag from '@muze-nl/jsontag';
import {source,isProxy,getIndex, getBuffer} from './symbols.mjs'

// faststringify function for a fast parseable arraybuffer output
// 

export default function stringify(value, meta, skipLength=false, index) {
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

	const innerStringify = (value) => {
		let indent = ""
		let gap = ""

		if (typeof space === "number") {
			indent += " ".repeat(space)
		} else if (typeof space === "string") {
			indent = space
		}

		const encodeProperties = (obj) => {
			return Object.getOwnPropertyNames(obj).map(prop => {
				let enumerable = obj.propertyIsEnumerable(prop) ? '' : '#'
				return enumerable+'"'+prop+'":'+str(prop, obj)
			}).join(',')
		}

		const encodeEntries = (arr) => {
			let result = arr.map((value,index) => {
				return str(index, arr)
			}).join(",")
			return result
		}

		const createId = (value) => {
			if (typeof crypto === 'undefined') {
				console.error('JSONTag: cannot generate uuid, crypto support is disabled.')
				throw new Error('Cannot create links to resolve references, crypto support is disabled')
			}
			if (typeof crypto.randomUUID === 'function') {
				var id = crypto.randomUUID()
			} else {
				var id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
					(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
				);
			}
			JSONTag.setAttribute(value, 'id', id)
			return id
		}

		const encoder = new TextEncoder()
		const decoder = new TextDecoder()

		const str = (key, holder) => {
			let value = holder[key]
			let result, updateReference
			// if value is a valueProxy, just copy the input slice
			if (!JSONTag.isNull(value) && value[isProxy]) {
				return decoder.decode(value[getBuffer](index))
			}
			if (typeof value === 'undefined' || value === null) {
				return 'null'
			}
			if (JSONTag.getType(value) === 'object' && !Array.isArray(value)) {
				//} && references.has(value)) {
				let id = JSONTag.getAttribute(value, 'id')
				if (!id) {
					id = createId(value)
				}
				let reference
				if (!meta.index.id.has(id)) {
					reference = value[getIndex]
					if (typeof reference === 'undefined') {
						reference = resultArray.length
					}
					updateReference = reference
					meta.index.id.set(id, updateReference)
					resultArray.push('')
				} else {
					reference = meta.index.id.get(id)
					return '~'+reference
				}
			}
			if (Array.isArray(value)) {
				result = JSONTag.getTypeString(value) + "["+encodeEntries(value)+"]"
			} else if (value instanceof Object) {
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
						result = typeString + value
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
						result = typeString + value
					break
					case 'array': 
						let entries = encodeEntries(value) // calculate children first so parent references can add id attribute
						result = typeString + '[' + entries + '}'
					break
					case 'object': 
						if (JSONTag.isNull(value)) {
							result = typeString + "null"
						} else {
							let props = encodeProperties(value); // calculate children first so parent references can add id attribute
							result = typeString + '{' + props + '}'
						}
					break
					default:
						throw new Error(JSONTag.getType(value)+' type not yet implemented')
					break
				}
			} else {
				result = JSON.stringify(value)
			}
			if (typeof updateReference != 'undefined') {
				resultArray[updateReference] = result
				result = '~'+updateReference
			}
			return result
		}

		return str("", {"": value})
	}
		
	const encode = (s) => {
		if (skipLength) {
			return s
		}
		let length = new Blob([s]).size
		return '('+length+')'+s
	}

	innerStringify(value)
	return resultArray.map(encode).join("\n")
}