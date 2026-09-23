import idIndex from './index.id.mjs'
import offsetIndex from './index.offset.mjs'

const defaultIndex = {
	create(data, meta) {
		idIndex.create(data, meta)
		offsetIndex.create(data, meta)
	},
	update(data, meta, changes) {
		idIndex.update(data, meta, changes)
		offsetIndex.update(data, meta, changes)
	},
	finalize(serialized, meta, uuid = null) {
		return offsetIndex.writeSerialized(serialized, meta, uuid)
	},
	load(meta, uuid=null) {
		return {
			id: idIndex.load(meta, uuid),
		    offset: offsetIndex.load(meta, uuid)
		}
	}
}

export function finalizeIndex(index, serialized, meta, uuid = null) {
	const finalize = index.finalize ?? defaultIndex.finalize
	return finalize.call(index, serialized, meta, uuid)
}

export default defaultIndex
