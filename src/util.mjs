import JSONTag from '@muze-nl/jsontag'
import {appendRecord} from './storage.mjs'

export function deepFreeze(obj) {
    Object.freeze(obj)
    Object.keys(obj).forEach(prop => {
        if (typeof obj[prop] === 'object' && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop])
        }
    })
    return obj
}

export function isString(s) {
    return typeof s === 'string' || s instanceof String
}

export function joinArgs(args) {
    return args = args.map(arg => {
        if (isString(arg)) {
            return arg
        }
        else {
            return JSONTag.stringify(arg)
        }
    }).join(' ')
}

/**
 * atomic append to a log file, adds newline after each write
 * @param  {string} filename The filename to append to
 * @param  {string} data     The line to write
 * @return {void}
 */
export const appendFile = appendRecord
