import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import { getIndex } from '@muze-nl/od-jsontag/src/symbols.mjs'

export default {
	create(data, meta) {
		// jsontag parse automatically fills meta.index.id, so no need to create anything
		// just store meta.index.id in index.id.json
		const index = {}
		for (const key in meta.index.id.keys()) {
			const entity = meta.index.id.get(key)?.deref()
			if (entity) {
				index[key] = entity[getIndex]
			}
		}
		fs.writeFileSync(meta.data+'index.id.json', JSON.stringify(index))
	},
	update(data, meta, changes) {
		if (!changes.length) {
			return
		}
		const index = {}
		for (const entry of changes) {
			const id = JSONTag.getAttribute(entry, 'id')
			if (id) {
				const entity = meta.index.id.get(id)
				index[id] = entry[getIndex]
			}
		}
		fs.writeFileSync(meta.data+'/index.id.'+changes.uuid+'.json', JSON.stringify(index))
	},
	load(uuid=null) {
		let filename
		if (!uuid) {
			filename = 'index.id.json'
		} else {
			filename = 'index.id.'+filename+'.json'
		}
		return JSON.parse(fs.readFileSync(meta.data+filename))
	}
}
