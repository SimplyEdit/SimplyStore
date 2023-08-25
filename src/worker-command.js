import {expose} from 'threads/worker'
import JSONTag from '@muze-nl/jsontag'
import commands from './commands.mjs'

/**
 * Command Worker for threads.js library
 * returns JSONTag strings, since otherwise JSON.stringify is used
 * and type+attribute data gets lost
 */

let dataspace

/**
 * @TODO: check for valid command id
 * @TODO: write valid commands to command log, emit 'ok', check in server.mjs for that
 * @TODO: setTimeout or do above checks in server.mjs before queueing
 */
const command = {
	initialize(jsontag) {
        if (!jsontag) { throw new Error('missing jsontag parameter')}
		dataspace = JSONTag.parse(jsontag)
		return true
	},
	runCommand(request, commandStr) {
        if (!commandStr) { throw new Error('missing command parameter')}
        if (!request) { throw new Error('missing request parameter')}
		let response = {
			jsontag: true
		}
        let command = JSONTag.parse(commandStr) // raw body through express.raw()
        if (command && command.name && commands[command.name]) {
            try {
            	commands[command.name](dataspace, command, request)
                response.body = JSONTag.stringify(dataspace) //@TODO: this is inefficient, patch would be better
            } catch(err) {
				console.log(err)
                response.code = 422;
               	response.body = '<object class="Error">{"message":'+JSON.stringify(''+err)+',"code":422}'
            }
        } else {
        	response.code = 404
           	response.body = '<object class="Error">{"message":"Command '+command.name+' not found","code":404}'
        }
        return response
	}
}

expose(command)