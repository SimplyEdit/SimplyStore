import {types} from 'node:util'
import {clone} from '@muze-nl/jsontag/src/lib/functions.mjs'

/**
 * @TODO: when freezing changes, add them to the index
 * @TODO: remove old entries (replaced) from the index, when creating a clone
 * @TODO: don't add entries to the index that are already there
 */

/**
 * Contains a list of references for each child or value object
 * Usage:
 *   const refs = references.get(valueObject)
 * Returns an array of references in the form:
 *   [
 *   	{
 *   		source: WeakRef,
 *   		prop: String|Number
 *   	}
 *   ]
 * You need to call source.deref() and then check that the result is not null
 * @type {WeakMap}
 */
let references = new WeakMap()

let seen       = new WeakMap()

/**
 * Adds a reference to the references index, which source object and property
 * refer to which value object
 * @param {object} source        The source or parent object
 * @param {string|number} key    The property that refers the child or value object
 * @param {object} value         The value or child object
 */
function addReference(source,key,value) {
	if (value && typeof value === 'object' && Object.isFrozen(value)) {
		if (!references.has(value)) {
			references.set(value, [])
		}
		let list = references.get(value)
		//@TODO: should filter out other references to source+key
		list.push({
			source: new WeakRef(source),
			prop: key
		})
		if (!seen.has(value)) {
			seen.set(value,true)
			index(value)
		}
	}
}

/**
 * Adds the given object and all its children to the references index
 * The references index contains parent+property references that refer
 * to each child object. References are added as WeakRef's, so need
 * to be deref() to be used. Only objects are added to the reference,
 * as literal values cannot be shared / referenced anyway.
 * @param  {object} root The object to index
 * @return {void}
 */
export function index(root) {
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

/**
 * Returns an array with references for the child or value object
 * If no references exist, it will return an empty array
 * @param  {object} value The value or child object
 * @return {array}        The list of references or an empty array
 */
export function findReferences(value) {
	return references.get(value) || []
}


/**
 * This function creates a new immutable datastructure from an existing one
 * and an update function. The update function receives a single parameter, 
 * which is a draft for the immutable datastructure. Each change set in the draft
 * will appear in the new state
 * This function is built to be compatible with [immer](https://immerjs.github.io/immer/)
 * Except it will work on graphs, not just on trees. Also it uses @muze-nl/jsontag's clone
 * function, so attributes and types will survive in the resulting dataset.
 * 
 * @param  {object}   baseState immutable datastructure to change
 * @param  {function} updateFn  function that makes changes in the datastructure
 * @return {object}             new immutable datastructure which incorporates the changes
 */
export default function produce(baseState, updateFn) {
	let changes = []
	let values  = new Map()
	let clones  = new Map()

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
			return [ ...o ]
		}
		return { ...o }
	}

	/**
	 * Returns the clone for this value object.
	 * There is only ever one clone for each immutable baseState object
	 * If the value object is immutable, it will create a clone or return the existing clone.
	 * @param  {object} baseState The base value object
	 * @return {object}           The clone for this value object
	 */
	function getClone(baseState) {
		if (clones.has(baseState)) {
			return clones.get(baseState)
		}
		if (Object.isFrozen(baseState)) {
			const c = clone(baseState)
			changes.push(c)
			clones.set(baseState, c)
			// add c to references index for any property value that is immutable
			index(c)
			// find references to baseState
			const refs = findReferences(baseState)
			// replace them with clone
			refs.forEach(r => {
				let source = r.source.deref()
				if (!source) {
					return // continue
				}
				innerProduce(source, (draft) => {
					let current = getRealValue(draft[r.prop])
					if (current===getRealValue(baseState)) { // reference hasn't been changed yet
						draft[r.prop] = c
					}
				})
			})
			return c
		}
		return baseState // baseState is already a clone, since it is mutable
	}

	function createProxy(baseState) 
	{
		const proxy = new Proxy({baseState}, updateHandler)
		values.set(proxy, baseState)
		return proxy
	}

	function getProxyValue(value) {
		if (types.isProxy(value)) {
			return value
		}
		if (value && typeof value === 'object') {
			return createProxy(value)
		}
		return value
	}

	function getRealValue(value) {
		if (types.isProxy(value)) {
			value = values.get(value)
		}
		if (clones.has(value)) {
			value = clones.get(value)
		}
		return value
	}

	function registerChange(clone, prop, value) {
		if (value && typeof value === 'object') {
			if (Object.isFrozen(value)) {
				addReference(clone, prop, value)
			} else {
				changes.push(value) // makes sure it will get frozen
			}
		}
	}

	const updateHandler = {
		get(target, prop, receiver) {
			if (Array.isArray(target.baseState) && target.baseState[prop] instanceof Function) {
				return (...args) => {
					let clone = getClone(target.baseState)
					let before = shallowClone(clone)
					let result = Array.prototype[prop].apply(clone, args)
					// find differences
					if (before.length>clone.length) {
						for(let i=0,l=before.length-1;i++;i<=l) {
							if (before[i]!==clone[i]) {
								registerChange(clone, i, clone[i])
							}
						}
					} else {
						for(let i=0,l=clone.length;i++;i<=l) {
							if (before[i]!==clone[i]) {
								registerChange(clone, i, clone[i])
							}
						}
					}
					return result
				}
			} else if (Array.isArray(target.baseState)) {
				switch(prop) {
					case 'length':
						return getRealValue(target.baseState).length
					break
				}
			}
			return getProxyValue(target.baseState[prop])
		},
		set(target, prop, value) {
			let clone = getClone(target.baseState)
			value = getRealValue(value)
			clone[prop] = value
			registerChange(clone, prop, value)
			return true
		},
		deleteProperty(target, prop) {
			let clone = getClone(target.baseState)
			delete clone[prop]
		},
		getOwnPropertyDescriptor(target, prop) {
			baseState = target.baseState
			if (clones.has(baseState)) {
				baseState = clones.get(baseState)
			}
			// make sure properties are enumerable, configurable,
			if (baseState.hasOwnProperty(prop)) {
				return {
					configurable: true,
					enumerable: true,
					value: getProxyValue(baseState[prop])
				}
			}
			//return undefined
		}
	}

	function innerProduce(baseState, updateFn) {
		let proxy;
		if (types.isProxy(baseState)) {
			proxy = baseState
		} else {
			proxy = createProxy(baseState)
		}
		updateFn(proxy)
		if (clones.has(baseState)) {
			return clones.get(baseState)
		}
		return baseState // no changes were made
	}

	if (!references.size) {
		index(baseState)
	}

	let nextState = innerProduce(baseState, updateFn)
	changes.forEach(entry => {
		Object.freeze(entry)
	})
	return nextState
}