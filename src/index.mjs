import idIndex, { prepareIdIndex } from './index.id.mjs'
import offsetIndex from './index.offset.mjs'

const defaultIndex = {
	create(data, meta) {
		offsetIndex.create(data, meta)
	},
	update(data, meta, changes) {
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

export async function finalizeIndex(
	index, serialized, meta, uuid = null, prepared = prepareIdIndex(serialized)
) {
	const finalize = index.finalize ?? defaultIndex.finalize
	await finalize.call(index, serialized, meta, uuid)
	idIndex.write(meta, prepared.entries, uuid)
	meta.index = { ...meta.index, id: prepared.ids }
}

export default defaultIndex
