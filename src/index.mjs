import idIndex from './index.id.mjs'

export default index = {
	create(data, meta) {
		idIndex.create(data, meta)
	}

	update(data, meta, changes) {
		idIndex.update(data, meta, changes)
	}

	load(data, meta, uuid=null) {
		idIndex.load(data, meta, uuid)
	}
}