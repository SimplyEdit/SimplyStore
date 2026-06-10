import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import { getIndex, position } from '@muze-nl/od-jsontag/src/symbols.mjs'

export default {
	create(data, meta) {
		// jsontag parse automatically fills meta.index.offset, so no need to create anything
		// just store meta.index.id in index.id.json
		const index = {}
		for (const key in meta.index.id.keys()) {
			const entity = meta.index.id.get(key)?.deref()
			if (entity) {
				index[entity[getIndex]] = [ entity[position].start, entity[position].end ]
			}
		}
		fs.writeFileSync(meta.data+'index.offset.json', JSON.stringify(index))
	},
	update(data, meta, changes) {
		if (!changes.length) {
			return
		}
		const index = {}
		for (const entry of changes) {
			let pos = entry[position]
			if (pos) {
				index[entry[getIndex]] = [ pos.start, pos.end ]
			}
		}
		fs.writeFileSync(meta.data+'/index.offset.'+changes.uuid+'.json', JSON.stringify(index))
	},
	load(uuid=null) {
		let filename
		if (!uuid) {
			filename = 'index.offset.json'
		} else {
			filename = 'index.offset.'+filename+'.json'
		}
		return JSON.parse(fs.readFileSync(meta.data+filename))
	}
}
