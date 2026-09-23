import { publishFileSync } from './storage.mjs'
import { indexPath, readIndexFile } from './index-files.mjs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { publishFile as writeFileAtomic } from './storage.mjs'
import { getIndex, position } from '@muze-nl/od-jsontag/src/symbols.mjs'
import { scanOdJsonTagRecords } from './recovery.mjs'

export default {
	async writeSerialized(buffer, meta, uuid = null) {
		let name = 'index.offset.json'
		if (uuid !== null) {
			name = `index.offset.${uuid}.json`
		}
		const filename = path.join(meta.data, name)
		let bytes
		if (typeof buffer === 'string') {
			bytes = Buffer.from(buffer)
		}
		else {
			bytes = Buffer.from(
				buffer.buffer,
				buffer.byteOffset,
				buffer.byteLength
			)
		}
		const index = {}
		scanOdJsonTagRecords(
			bytes,
			filename,
			'offset source OD-JSONTag data',
			(record, start, end) => {
				index[record] = [start, end]
			}
		)
		await writeFileAtomic(filename, JSON.stringify(index))
	},
	create(data, meta) {
		console.log('creating ' + meta.data + '/index.offset.json')
		// jsontag parse automatically fills meta.index.offset, so no need to
		// create anything
		const index = {}
		const max = meta.resultArray.length
		for (let i = 0; i < max; i++) {
			const entity = meta.resultArray[i]
			index[i] = [entity[position].start, entity[position].end]
		}
		publishFileSync(meta.data + '/index.offset.json', JSON.stringify(index))
	},
	update(data, meta, changes) {
		if (!changes.length) {
			return
		}
		const index = {}
		for (const entry of changes) {
			let pos = entry[position]
			if (pos) {
				index[entry[getIndex]] = [pos.start, pos.end]
			}
		}
		publishFileSync(
			meta.data + '/index.offset.' + changes.uuid + '.json',
			JSON.stringify(index)
		)
	},
	load(meta, uuid = null, options = {}) {
		return readIndexFile(indexPath(meta, 'offset', uuid), options)
	}
}
