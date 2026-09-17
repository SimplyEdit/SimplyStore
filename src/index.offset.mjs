import fs from 'fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import writeFileAtomic from 'write-file-atomic'
import { getIndex, position } from '@muze-nl/od-jsontag/src/symbols.mjs'
import { scanOdJsonTagRecords } from './recovery.mjs'

export default {
	async writeSerialized(buffer, meta, uuid = null) {
		const filename = path.join(meta.data, uuid === null ? 'index.offset.json' : `index.offset.${uuid}.json`)
		const bytes = typeof buffer === 'string' ? Buffer.from(buffer) : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
		const index = {}
		scanOdJsonTagRecords(bytes, filename, 'offset source OD-JSONTag data', (record, start, end) => {
			index[record] = [start, end]
		})
		await writeFileAtomic(filename, JSON.stringify(index))
	},
	create(data, meta) {
		console.log('creating '+meta.data+'/index.offset.json')
		// jsontag parse automatically fills meta.index.offset, so no need to create anything
		const index = {}
		const max = meta.resultArray.length
		for (let i=0;i<max;i++) {
			const entity = meta.resultArray[i]
			index[i] = [ entity[position].start, entity[position].end ]
		}
		fs.writeFileSync(meta.data+'/index.offset.json', JSON.stringify(index))
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
