import JSONTag from '@muze-nl/jsontag'

export default class TripleStore {

	triples=[]

	constructor(jsontag) {
		this.makeTripleStore(jsontag)
	}

    makeTripleStore(jsontag, parent=null, predicate=null) {
		if (Array.isArray(jsontag)) {
			jsontag.forEach(e => {
				this.makeTripleStore(e, parent, predicate)
			})
		} else if (typeof jsontag === 'object') {
			if (parent) {
				this.triples.push([parent, predicate, jsontag ])
			}
			let tagname = JSONTag.getType(jsontag)
			this.triples.push([jsontag, '@tag', tagname])
			let attributes = JSONTag.getAttributes(jsontag)
			Object.keys(attributes).forEach(a => {
				this.triples.push([jsontag, '@attr/'+a, attributes[a]])
			})
			// handle String, Number, Boolean seperately.. don't forEach there
			if (JSONTag.getType(jsontag)==='object') {
				Object.keys(jsontag).forEach(p => {
					this.makeTripleStore(jsontag[p], jsontag, p);
				})
			}
		} else {
			this.triples.push([parent, predicate, jsontag]) 
		}
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
		return this.triples
	}
}