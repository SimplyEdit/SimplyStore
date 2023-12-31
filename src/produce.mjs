import {types} from 'node:util'
import {clone} from '@muze-nl/jsontag/src/lib/functions.mjs'

/**
 * This library implements a version of [immer](https://immerjs.github.io/immer/)
 * with one important difference: it works on graphs instead of just trees.
 * This does mean we take a performance hit, the first time produce is called it creates
 * a complete index of which object references which other object (and in which property)
 * Additionally it uses the JSONTag clone method to also copy type/attributes from JSONTag
 *
 * --------------------------------------------------------
 *
 * Implementation details:
 *
 * produce starts an update function, where the baseState is replaced with a proxy. This proxy
 * automatically creates mutable clones whenever you set/delete or otherwise update something
 * on the proxy. Each change creates a clone, and each reference to the original base object is 
 * replaced with the clone, which triggers creating clones of the objects containing that
 * reference. This means that any change will always create a new clone of the root baseState
 * object. This object represents the changed nextState, where baseState is not changed as it 
 * is immutable. Before finishing, all clones are made immutable again.
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

/**
 * Keeps track of objects to make sure addReference doesn't go into an infinite loop
 * @type {WeakMap}
 */
let seen       = new WeakMap()

/**
 * Adds a reference to the references index, which source object and property
 * refer to which value object
 * @param {object} source        The source or parent object
 * @param {string|number} key    The property that refers the child or value object
 * @param {object} value         The value or child object
 * @return {void}
 */
function addReference(source,key,value) {
	if (value && typeof value === 'object' && Object.isFrozen(value)) {
		if (!references.has(value)) {
			references.set(value, [])
		}
		let list = references.get(value)
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
 * Removes a reference from the references index, for the given value
 * and source and key
 * @param {object} source        The source or parent object
 * @param {string|number} key    The property that refers the child or value object
 * @param {object} value         The value or child object
 * @return {void}
 */
function removeReference(source, key, value) {
	if (value && typeof value === 'object' && Object.isFrozen(value) && references.has(value)) {
		// only do the expensive work if needed, references only keeps track of frozen objects
		let list = references.get(value)
		list = list.filter(r => {
			if (r.source.deref()===source && r.prop===key) {
				return false
			}
			return true
		})
		references.set(value, list)
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
export function produce(baseState, updateFn) {
	/**
	 * This contains a reference from a Proxy to the original object being proxied
	 * @type {Map}
	 */
	let values  = new Map()

	/**
	 * This contains a reference from an original, immutable object, to its mutable clone
	 * @type {Map}
	 */
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

	/**
	 * Given a baseState (frozen) object, this will return a Proxy for it.
	 * given a literal, it will just return the literal
	 * given a proxy, it will just return the proxy
	 * given a mutable object, it will return the object as it needs no proxy
	 * @param  {any}       value The baseState immutable value to proxy
	 * @return {any|Proxy}       The proxy, if given an immutable object
	 */
	function getProxyValue(value) {
		if (types.isProxy(value)) {
			return value
		}
		//@FIXME: it would be nice if there is only ever one proxy of a given value
		if (value && typeof value === 'object' && Object.isFrozen(value)) {
			const proxy = new Proxy({baseState:value}, updateHandler)
			values.set(proxy, value)
			return proxy
		}
		return value
	}

	/**
	 * Given a Proxy object, it will return the original value (baseState) the Proxy
	 * was started with. If a clone of that original value is available, it will
	 * return that.
	 * Given a frozen baseState object, it will return a clone, if available, since that
	 * contains the most current state of the object.
	 * @param  {object} value The potential proxy object or frozen object
	 * @return {object}       The current state object for this value
	 */
	function getRealValue(value) {
		if (types.isProxy(value)) {
			value = values.get(value)
		}
		if (clones.has(value)) {
			value = clones.get(value)
		}
		return value
	}

	/**
	 * This handler automatically returns proxies for all get accesses that result in an object
	 * It wraps array functions so that results get proxied, parameters get de-proxied and the
	 * actual function is called on the current state of the target object, or for functions that
	 * change the actual array, on the clone.
	 * @type {Object}
	 */
	const updateHandler = {
		get(target, prop, receiver) {
			if (Array.isArray(target.baseState) && target.baseState[prop] instanceof Function) {
				switch(prop) {
					case 'copyWithin':
					case 'fill':
					case 'pop':
					case 'push':
					case 'reverse':
					case 'shift':
					case 'sort':
					case 'splice':
					case 'unshift':
						// these are all functions that alter the array itself, so it
						// needs to be cloned, if not done so already
						// 
						return (...args) => {
							args = args.map(arg => getRealValue(arg))
							let clone = getClone(target.baseState)
							let before = shallowClone(clone)
							let result = Array.prototype[prop].apply(clone, args)
							// find differences
							if (before.length>clone.length) {
								for(let i=0,l=before.length-1;i++;i<=l) {
									if (before[i]!==clone[i]) {
										removeReference(clone, i, before[i])
										addReference(clone, i, clone[i])
									}
								}
							} else {
								for(let i=0,l=clone.length;i++;i<=l) {
									if (before[i]!==clone[i]) {
										removeReference(clone, i, before[i])
										addReference(clone, i, clone[i])
									}
								}
							}
							return result
						}
					break
					default:
						return (...args) => {
							args = args.map(arg => getRealValue(arg))
							return Array.prototype[prop].apply(getRealValue(target.baseState), args)
						}

					break
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
			removeReference(clone, prop, clone[prop])
			clone[prop] = value
			addReference(clone, prop, value)
			return true
		},
		deleteProperty(target, prop) {
			let clone = getClone(target.baseState)
			removeReference(clone, prop, clone[prop])
			delete clone[prop]
		}
	}

	/**
	 * Runs the update function on the proxy (draft) of the baseState
	 * This function is recursively called to update parent objects that
	 * reference the baseState object when a clone is made.
	 * @param  {object} baseState  The base immutable object to alter
	 * @param  {function} updateFn The update function that alters it
	 * @return {object}            The nextState, mutable clone
	 */
	function innerProduce(baseState, updateFn) {
		let proxy = getProxyValue(baseState)
		updateFn(proxy)
		if (clones.has(baseState)) {
			return clones.get(baseState)
		}
		return baseState // no changes were made
	}

	if (!references.size) {
		// automatically initialize the references index
		index(baseState)
	}

	let nextState = innerProduce(baseState, updateFn)

	clones.forEach(entry => {
		Object.freeze(entry)
		index(entry) // so the references match for the next produce call
	})

	return nextState
}