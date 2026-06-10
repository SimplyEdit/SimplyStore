import idIndex from './index.id.mjs'
import offsetIndex from './index.offset.mjs'

export default {
	create(data, meta) {
		idIndex.create(data, meta)
		offsetIndex.create(data, meta)
	},
	update(data, meta, changes) {
		idIndex.update(data, meta, changes)
		offsetIndex.update(data, meta, changes)
	},
	load(meta, uuid=null) {
		return {
			id: idIndex.load(uuid),
		    offset: offsetIndex.load(uuid)
		}
	}
}