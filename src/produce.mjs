import {types} from 'node:util'
import {clone} from '@muze-nl/jsontag/src/lib/functions.mjs'


export default function produce(original, updateFn) {
	let changes = []
	let index   = new WeakMap()
	let seen    = new WeakMap()
	let values  = new Map()
	let clones  = new Map()

	function addReference(source,key,value) {
		if (value && typeof value === 'object' && Object.isFrozen(value)) {
			if (!index.has(value)) {
				index.set(value, [])
			}
			let list = index.get(value)
			//@TODO: should filter out other references to source+prop
			list.push({
				source: new WeakRef(source),
				prop: key
			})
			console.log('added reference',source,key,value)
			if (!seen.has(value)) {
				seen.set(value,true)
				createReferenceIndex(value)
			}
		}
	}

	function createReferenceIndex(root) {
		if (root && typeof root === 'object' && Object.isFrozen(root)) {
			if (Array.isArray(root)) {
				root.forEach((element, index) => {
					addReference(root, index, element)
				})
			} else {
				Object.entries(root).forEach(([prop, element]) => {
					addReference(root, prop, element)
				})
			}
		}
	}

	function findReferences(target) {
		return index.get(target) || []
	}

	function shallowClone(o) {
		if (o instanceof Number) {
			return new Number(o)
		}
		if (o instanceof Boolean) {
			return new Boolean(o)
		}
		if (o instanceof String) {
			return new String(o)
		}
		if (Array.isArray(o)) {
			// @TODO: also copy ownProperties
			return [ ...o ]
		}
		return { ...o }
	}

	function getClone(target) {
		if (clones.has(target)) {
			return clones.get(target)
		}
		if (Object.isFrozen(target)) {
			console.log('cloning',target)
			const c = clone(target)
			changes.push(c)
			clones.set(target, c)
			// add c to references index for any property value that is immutable
			createReferenceIndex(c)
			// find references to target
			const references = findReferences(target)
			console.log('references',references)
			// replace them with clone
			references.forEach(r => {
				let source = r.source.deref()
				if (!source) {
					console.log('source freed',r)
					return // continue
				}
				console.log('updating',source)
				innerProduce(source, (draft) => {
					let current = draft[r.prop]
					if (types.isProxy(current)) {
						console.log('deProxying ',r.prop,current)
						current = values.get(current)
						console.log('current is now', current)
					} else {
						console.log('no deProxying needed',r.prop,current)
					}
					if (current===target) { // reference hasn't been changed yet
						draft[r.prop] = c
					} else {
						console.log('source no longer points to target for prop', r.prop, source, target)
						if (types.isProxy(target)) {
							console.log('target is a proxy')
						} else if (types.isProxy(source[r.prop])) {
							console.log('source['+r.prop+'] is a proxy')
						} else {
							console.log('something else')
						}
					}
				})
			})
			return c
		}
		return target // target is already a clone, since it is mutable
	}

	function createProxy(original) 
	{
		const proxy = new Proxy({original}, updateHandler)
		values.set(proxy, original)
		return proxy
	}

	const updateHandler = {
		get(target, prop, receiver) {
//			console.log('get',prop)
			if (Array.isArray(target.original) && target.original[prop] instanceof Function) {
				switch(prop) {
					case 'push': 
//						console.log('array.push')
						return (...args) => {
//							console.log('array.push called',args)
							let clone = getClone(target.original)
							args.forEach(value => {
								if (types.isProxy(value)) {
									value = values.get(value)
									if (clones.has(value)) {
										value = clones.get(value)
									}
								}
								clone.push(value)
								if (value && typeof value === 'object') {
									changes.push(value)
									if (Object.isFrozen(value)) {
										addReference(clone, prop, value)
									}
								}
							})
							return clone.length
						}
					break
				}
			}
			if (target.original[prop] && typeof target.original[prop] === 'object') {
				return createProxy(target.original[prop])
			}
			return target.original[prop]
		},
		set(target, prop, value) {
			let clone = getClone(target.original)

			if (types.isProxy(value)) {
				value = values.get(value)
				if (clones.has(value)) {
					value = clones.get(value)
				}
			}

			clone[prop] = value

			// if value is an object, make sure it gets frozen at the end as well
			if (value && typeof value === 'object') {
				changes.push(value) //@FIXME: don't do this if it already is a clone
				if (Object.isFrozen(value)) {
					addReference(clone, prop, value)
				}
			}
			return true
		},
		deleteProperty(target, prop) {
			let clone = getClone(target.original)
			delete clone[prop]
		},
		getOwnPropertyDescriptor(target, prop) {
			// make sure properties are enumerable, configurable,
			if (target.original.hasOwnProperty(prop)) {
				return {
					configurable: true,
					enumerable: true,
					value: target.original[prop]
				}
			}
			//@FIXME: return what otherwise?
		}
	}

	function innerProduce(original, updateFn) {
		let proxy;
		if (types.isProxy(original)) {
			proxy = original
		} else {
			proxy = createProxy(original)
		}
		updateFn(proxy)
		if (clones.has(original)) {
			console.log('return new root')
			return clones.get(original)
		}
		console.log('no changes made')
		return original // no changes were made
	}

	console.log('creating index')
	createReferenceIndex(original)
	console.log('index done')

	let newRoot = innerProduce(original, updateFn)

	console.log('changes',changes)
	changes.forEach(entry => {
		Object.freeze(entry)
	})
	console.log('dataspace', newRoot)
	return newRoot
}