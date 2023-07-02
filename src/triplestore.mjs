import JSONTag from '@muze-nl/jsontag'

export default class TripleStore {

	triples=[]
	#index
	#availablePredicates

	constructor(jsontag) {
		this.#index = {
			subject: new WeakMap(),
			predicate: {},
			object: new WeakMap(),
			value: {}
		}
		this.#availablePredicates = new Set()
		this.makeTripleStore(jsontag)
		this.createIndex()
		console.log(this.#availablePredicates)
	}

    makeTripleStore(jsontag, parent=null, predicate=null) {
    	let seen = new Map()
    	let addTriples = (jsontag, parent=null, predicate=null) => {
    		if (jsontag && typeof jsontag === 'object' && typeof jsontag.id !== 'undefined') {
	    		if (seen[jsontag.id]) {
	    			return
	    		}
	    		seen[jsontag.id] = true
	    	}
			if (Array.isArray(jsontag)) {
				jsontag.forEach(e => {
					addTriples(e, parent, predicate)
				})
			} else if (typeof jsontag === 'object') {
				if (parent) {
					this.triples.push([parent, predicate, jsontag ])
					this.#availablePredicates.add(predicate)
				}
				let tagname = JSONTag.getType(jsontag)
				this.triples.push([jsontag, '@tag', tagname])
				this.#availablePredicates.add('@tag')
				let attributes = JSONTag.getAttributes(jsontag)
				Object.keys(attributes).forEach(a => {
					this.triples.push([jsontag, '@attr/'+a, attributes[a]])
					this.#availablePredicates.add('@attr/'+a)
				})
				// handle String, Number, Boolean seperately.. don't forEach there
				if (jsontag && JSONTag.getType(jsontag)==='object') {
					Object.keys(jsontag).forEach(p => {
						addTriples(jsontag[p], jsontag, p);
					})
				}
			} else {
	/*
				switch(typeof jsontag) {
					case 'number':
						jsontag = new Number(jsontag)
					break
					case 'boolean':
						jsontag = new Boolean(jsontag)
					break
					case 'string':
						jsontag = new String(jsontag)
					break
					default:
						return
					break
				}
	*/
				this.triples.push([parent, predicate, jsontag]) 
				this.#availablePredicates.add(predicate)
			}
		}
		addTriples(jsontag)
	}

	query({ find, where }) {
		return this.queryWhere(where).map(context => this.actualize(context, find))
	}

	actualize(context, find) {
		return find.map( findPart => {
			return this.isVariable(findPart) ? context[findPart] : findPart
		})
	}

	queryWhere(patterns) {
		return patterns.reduce( (contexts, pattern) => {
			return contexts.flatMap( context => this.querySingle(pattern, context))
		}, [{}])
	}

	querySingle(pattern, context) {
		return this.relevantTriples(pattern)
		.map(triple => this.matchPattern(pattern, triple, context))
		.filter( x => x)
	}

	matchPattern(pattern, triple, context) {
		return pattern.reduce((context, patternPart, idx) => {
			const triplePart = triple[idx]
			return this.matchPart(patternPart, triplePart, context)
		}, context)
	}

	matchPart(patternPart, triplePart, context) {
		if (!context) {
			return null
		}
		if (this.isVariable(patternPart)) {
			return this.matchVariable(patternPart, triplePart, context)
		}
		if (patternPart instanceof Function) {
			return (patternPart(triplePart) ? context : null)
		}
		return patternPart == triplePart ? context : null
	}

	isVariable(x) {
		return typeof x === 'string' && x.startsWith('?')
	}

	matchVariable(variable, triplePart, context) {
		if (context.hasOwnProperty(variable)) {
			const bound = context[variable]
			return this.matchPart(bound, triplePart, context)
		}
		return { ...context, [variable]: triplePart }
	}

	relevantTriples(pattern) {
		const [subject, predicate, object] = pattern
		if (!this.#availablePredicates.has(predicate)) {
			throw new Error('TripleStore does not contain predicate '+predicate)
		}
		if (!this.isVariable(subject)) {
		    return this.#index.subject[subject] || []
		}
		if (!this.isVariable(predicate)) {
		    return this.#index.predicate[predicate] || []
		}
		if (!this.isVariable(object)) {
			if (typeof object === 'object') {
			    return this.#index.object[object] || []
			} else {
				return this.#index.value[object] || []
			}
		}
		return this.triples
	}

	createIndex() {
		this.indexBy(0, this.#index.subject)
		this.indexBy(1, this.#index.predicate)
		this.indexBy(2, this.#index.object, this.#index.value)
	}

	indexBy(idx, index1, index2=null) {
		let count = 0;
		return this.triples.forEach((triple) => {
//			let used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
//			console.log(idx, count++, used)
			const k = triple[idx]
			if (typeof k === 'object') {
				index1[k] = index1[k] || []
				index1[k].push(triple)
				if (index2 && JSONTag.getType(k)!=='object' && JSONTag.getType(k)!=='array') {
					let v = k.valueOf()
					index2[v] = index2[v] || []
					index2[v].push(triple)
				}
			} else if (index2) {
				index2[k] = index2[k] || []
				index2[k].push(triple)
			} else {
				index1[k] = index1[k] || []
				index1[k].push(triple)
			}
		})
	}
}