import SimplyStore from '@muze-nl/simplystore'
import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'

let str = fs.readFileSync(process.cwd()+'/data.jsontag','utf-8')
const data = JSONTag.parse(str)

SimplyStore.run({
	dataspace: data
})

