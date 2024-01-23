import JSONTag from '@muze-nl/jsontag';
import Null from '@muze-nl/jsontag/src/lib/Null.mjs'

const decoder = new TextDecoder()
export const source = Symbol('source')

export default function parse(input, meta)
{
    if (!meta) {
        meta = {}
    }
    if (!meta.index) {
        meta.index = {}
    }
    if (!meta.index.id) {
        meta.index.id = new Map()
    }
    if (!meta.unresolved) {
        meta.unresolved = new Map()
    }
    if (!meta.baseURL) {
        meta.baseURL = 'http://localhost/'
    }

    let at, ch, value, result;
    let escapee = {
        '"': '"',
        "\\":"\\",
        '/': '/',
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t"
    }
    let offsetArray = []

    let error = function(m)
    {
        let context
        try {
            context = decoder.decode(input.slice(at-100,at+100));
        } catch(err) {}
        throw {
            name: 'SyntaxError',
            message: m,
            at: at,
            input: context
        }
    }

    if (!(input instanceof Uint8Array)) {
        error('fast parse only accepts Uint8Array as input')
    }

    let next = function(c)
    {
        if (c && c!==ch) {
            error("Expected '"+c+"' instead of '"+ch+"'")
        }
        ch = String.fromCharCode(input.at(at))
        at+=1
        return ch
    }
    
    let number = function(tagName)
    {
        let numString = ''
        if (ch==='-') {
            numString = '-'
            next('-')
        }
        while(ch>='0' && ch<='9') {
            numString += ch
            next()
        }
        if (ch==='.') {
            numString+='.'
            while(next() && ch >= '0' && ch <= '9') {
                numString += ch
            }
        }
        if (ch === 'e' || ch === 'E') {
            numString += ch
            next()
            if (ch === '-' || ch === '+') {
                numString += ch
                next()
            }
            while (ch >= '0' && ch <= '9') {
                numString += ch
                next()
            }
        }
        let result = new Number(numString).valueOf()
        if (tagName) {
            switch(tagName) {
                case "int":
                    isInt(numString)
                    break
                case "uint":
                    isInt(numString, [0,Infinity])
                    break
                case "int8":
                    isInt(numString, [-128,127])
                    break
                case "uint8":
                    isInt(numString, [0,255])
                    break
                case "int16":
                    isInt(numString, [-32768,32767])
                    break
                case "uint16":
                    isInt(numString, [0,65535])
                    break
                case "int32":
                    isInt(numString, [-2147483648, 2147483647])
                    break
                case "uint32":
                    isInt(numString, [0,4294967295])
                    break
                case "timestamp":
                case "int64":
                    isInt(numString, [-9223372036854775808,9223372036854775807])
                    break
                case "uint64":
                    isInt(numString, [0,18446744073709551615])
                    break
                case "float":
                    isFloat(numString)
                    break
                case "float32":
                    isFloat(numString, [-3.4e+38,3.4e+38])
                    break
                case "float64":
                    isFloat(numString, [-1.7e+308,+1.7e+308])
                    break
                case "number":
                    //FIXME: what to check? should already be covered by JSON parsing rules?
                    break
                default:
                    isTypeError(tagName, numString)
                    break
            }
        }
        return result
    }

    let isTypeError = function(type, value)
    {
        error('Syntax error, expected '+type+', got: '+value)
    }

    const regexes = {
        color: /^(rgb|hsl)a?\((\d+%?(deg|rad|grad|turn)?[,\s]+){2,3}[\s\/]*[\d\.]+%?\)$/i,
        email: /^[A-Za-z0-9_!#$%&'*+\/=?`{|}~^.-]+@[A-Za-z0-9.-]+$/,
        uuid:  /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
        decimal: /^\d*\.?\d*$/,
        money: /^[A-Z]+\$\d*\.?\d*$/,
        duration: /^(-?)P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)([DW]))?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
        phone: /^[+]?(?:\(\d+(?:\.\d+)?\)|\d+(?:\.\d+)?)(?:[ -]?(?:\(\d+(?:\.\d+)?\)|\d+(?:\.\d+)?))*(?:[ ]?(?:x|ext)\.?[ ]?\d{1,5})?$/,
        time: /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/,
        date: /^-?[1-9][0-9]{3,}-([0][1-9]|[1][0-2])-([1-2][0-9]|[0][1-9]|[3][0-1])$/,
        datetime: /^(\d{4,})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/,
        range: /^\[-?(\d+\.)?\d+\,-?(\d+\.)?\d+\]$/
    }

    let isFloat = function(float, range)
    {
        let test = new Number(parseFloat(float))
        let str = test.toString()
        if (float!==str) {
            error('Syntax Error: expected float value')
        }
        if (range) {
            if (typeof range[0] === 'number') {
                if (test<range[0]) {
                    error('Syntax Error: float value out of range')
                }
            }
            if (typeof range[1] === 'number') {
                if (test>range[1]) {
                    error('Syntax Error: float value out of range')    
                }
            }
        }
    }
    
    let isInt = function(int, range)
    {
        let test = new Number(parseInt(int))
        let str = test.toString()
        if (int!==str) {
            error('Syntax Error: expected integer value')
        }
        if (range) {
            if (typeof range[0] === 'number') {
                if (test<range[0]) {
                    error('Syntax Error: integer value out of range')
                }
            }
            if (typeof range[1] === 'number') {
                if (test>range[1]) {
                    error('Syntax Error: integer value out of range')    
                }
            }
        }
    }

    let isColor = function(color)
    {
        let result = false
        if (color.charAt(0) === "#") {
            color = color.substring(1)
            result = ([3, 4, 6, 8].indexOf(color.length) > -1) && !isNaN(parseInt(color, 16))
            if (result.toString(16)!==color) {
                isTypeError('color', color)
            }
        } else {
            result = regexes.color.test(color)
        }
        if (!result) {
            isTypeError('color',color)
        }
        return true
    }

    let isEmail = function(email)
    {
        let result = regexes.email.test(email)
        if (!result) {
            isTypeError('email',email)
        }
        return true
    }

    let isUuid = function(uuid)
    {
        let result = regexes.uuid.test(uuid)
        if (!result) {
            isTypeError('uuid',uuid)
        }
        return true
    }

    let isDecimal = function(decimal)
    {
        let result = regexes.decimal.test(decimal)
        if (!result) {
            isTypeError('decimal',decimal)
        }
        return true
    }

    let isMoney = function(money)
    {
        let result = regexes.money.test(money)
        if (!result) {
            isTypeError('money',money)
        }
        return true
    }
    
    let isUrl = function(url)
    {
        try {
            return Boolean(new URL(url, meta.baseURL))
        } catch(e) {
            isTypeError('url',url)
        }
    }
    
    let isDuration = function(duration)
    {
        let result = regexes.duration.test(duration)
        if (!result) {
            isTypeError('duration',duration)
        }
        return true
    }
    
    let isPhone = function(phone)
    {
        let result = regexes.phone.test(phone)
        if (!result) {
            isTypeError('phone',phone)
        }
        return true
    }
    
    let isRange = function(range)
    {
        let result = regexes.range.test(range)
        if (!result) {
            isTypeError('range',range)
        }
        return true
    }
    
    let isTime = function(time)
    {
        let result = regexes.time.test(time)
        if (!result) {
            isTypeError('time',time)
        }
        return true
    }
    
    let isDate = function(date)
    {
        let result = regexes.date.test(date)
        if (!result) {
            isTypeError('date',date)
        }
        return true
    }
    
    let isDatetime = function(datetime)
    {
        let result = regexes.datetime.test(datetime)
        if (!result) {
            isTypeError('datetime',datetime)
        }
        return true
    }

    let checkStringType = function(tagName, value)
    {
        if (!tagName) {
            return
        }
        switch(tagName){
            case "object":
            case "array":
            case "int8":
            case "uint8":
            case "int16":
            case "uint16":
            case "int32":
            case "uint32":
            case "int64":
            case "uint64":
            case "int":
            case "uint":
            case "float32":
            case "float64":
            case "float":
            case "timestamp":
                isTypeError(tagName, value)
                break
            case "uuid":
                return isUuid(value)
            case "decimal":
                return isDecimal(value)
            case "money":
                return isMoney(value)
            case "url":
                return isUrl(value)
            case "link":
            case "string":
            case "text":
            case "blob":
            case "hash":
                //anything goes
                return true
            case "color":
                return isColor(value)
            case "email":
                return isEmail(value)
            case "duration":
                return isDuration(value)
            case "phone":
                return isPhone(value)
            case "range":
                return isRange(value)
            case "time":
                return isTime(value)
            case "date":
                return isDate(value)
            case "datetime":
                return isDatetime(value)
        }
        error('Syntax error: unknown tagName '+tagName)
    }    

    let string = function(tagName)
    {
        let value = "", hex, i, uffff;
        if (ch !== '"') {
            error("Syntax Error")
        }
        next('"')
        while(ch) {
            if (ch==='"') {
                next()
                checkStringType(tagName, value)
                return value
            }
            if (ch==='\\') {
                next()
                if (ch==='u') {
                    uffff=0
                    for (i=0; i<4; i++) {
                        hex = parseInt(next(), 16)
                        if (!isFinite(hex)) {
                            break
                        }
                        uffff = uffff * 16 + hex
                    }
                    value += String.fromCharCode(uffff)
                    next()
                } else if (typeof escapee[ch] === 'string') {
                    value += escapee[ch]
                    next()
                } else {
                    break
                }
            } else {
                value += ch
                next()
            }
        }
        error("Syntax error: incomplete string")
    }

    let tag = function()
    {
        let key, val, tagOb={
            attributes: {}
        }
        if (ch !== '<') {
            error("Syntax Error")
        }
        next('<')
        key = word()
        if (!key) {
            error('Syntax Error: expected tag name')
        }
        tagOb.tagName = key
        whitespace()
        while(ch) {
            if (ch==='>') {
                next('>')
                return tagOb
            }
            key = word()
            if (!key) {
                error('Syntax Error: expected attribute name')
            }
            whitespace()
            next('=')
            whitespace()
            val = string()
            tagOb.attributes[key] = val
            whitespace()
        }
        error('Syntax Error: unexpected end of input')
    }

    let whitespace = function()
    {
        while (ch) {
            switch(ch) {
                case ' ':
                case "\t":
                case "\r":
                case "\n":
                    next()
                break
                default:
                    return
                break
            }
        }
    }

    let word = function()
    {
        //[a-z][a-z0-9_]*
        let val='';
        if ((ch>='a' && ch<='z') || (ch>='A' && ch<='Z')) {
            val += ch
            next()
        } else {
            error('Syntax Error: expected word')
        }
        while((ch>='a' && ch<='z') || (ch>='A' && ch<='Z') || (ch>='0' && ch<='9') || ch=='_') {
            val += ch
            next()
        }
        return val
    }

    let boolOrNull = function(tagName)
    {
        let w = word()
        if (!w || typeof w !== 'string') {
            error('Syntax error: expected boolean or null, got "'+w+'"')
        }
        switch(w.toLowerCase()) {
            case 'true':
                if (tagName && tagName!=='boolean') {
                    isTypeError(tagName,w)
                }
                return true
            break
            case 'false':
                if (tagName && tagName!=='boolean') {
                    isTypeError(tagName,w)
                }
                return false 
            break
            case 'null':
                return null
            break
            default:
                error('Syntax error: expected boolean or null, got "'+w+'"')
            break
        }
    }

    let checkUnresolved = function(item, object, key)
    {
        if (JSONTag.getType(item)==='link') {
            let link = ''+item
            let links = meta.unresolved.get(link)
            if (typeof links === 'undefined') {
                meta.unresolved.set(link,[])
                links = meta.unresolved.get(link)
            }
            let count = links.push({
                src: new WeakRef(object),
                key: key
            })
        }
    }

    let array = function()
    {
        let item, array = []
        if (ch !== '[') {
            error("Syntax error")
        }
        next('[')
        whitespace()
        if (ch===']') {
            next(']')
            return array
        }
        while(ch) {
            item = value()
            checkUnresolved(item, array, array.length)
            array.push(item)
            whitespace()
            if (ch===']') {
                next(']')
                return array
            }
            next(',')
            whitespace()
        }
        error("Input stopped early")
    }

    let object = function()
    {
        let key, val, object={}
        if (ch !== '{') {
            error("Syntax Error")
        }
        next('{')
        whitespace()
        if (ch==='}') {
            next('}')
            return object
        }
        let enumerable = true
        while(ch) {
            if (ch==='#') {
                enumerable = false
                next()
            } else {
                enumerable = true
            }
            key = string()
            if (key==='__proto__') {
                error("Attempt at prototype pollution")
            }
            whitespace()
            next(':')
            val = value()
            if (!enumerable) {
                Object.defineProperty(object,key, { value: val})
            } else {
                object[key] = val
            }
            checkUnresolved(val, object, key)
            whitespace()
            if (ch==='}') {
                next('}')
                return object
            }
            next(',')
            whitespace()
        }
        error("Input stopped early")
    }

    let length = function()
    {
        whitespace()
        next('(')
        let numString=''
        while(ch>='0' && ch<='9') {
            numString += ch
            next()
        }
        if (ch!==')') {
            error('Syntax error: not a length')
        }
        next()
        return parseInt(numString)
    }

    let offset = function()
    {
        next('~')
        let numString = ''
        while(ch>='0' && ch<='9') {
            numString += ch
            next()
        }
        return parseInt(numString)
    }

    let parseValue = function(position) {
        at = position.start
        next()
        return value()
    }

    let valueProxy = function(length)
    {
        // current offset + length contains jsontag of this value
        let position = {
            start: at-1,
            end: at+length-1
        }
        let cache = {}
        let parsed = false
        at += length
        next()
        //@FIXME: toString method on proxy should run cache toString, if filled
        //or return slice of the input from start to end
        return new Proxy(cache, {
            get(target, prop, receiver) {
                if (!parsed) {
                    cache = parseValue(position)
                    parsed = true
                }
                if (prop===source) {
                    return cache
                }
                return cache[prop]
            },
            has() {
                if (!parsed) {
                    cache = parseValue(position)
                    parsed = true
                }
                return typeof cache[prop] !== 'undefined'
            },
            ownKeys() {
                if (!parsed) {
                    cache = parseValue(position)
                    parsed = true
                }
                return Reflect.ownKeys(cache)
            }
        })
    }

    value = function()
    {
        let tagOb, result, tagName;
        whitespace()
        if (ch==='~') {
            let vOffset = offset()
            return resultArray[vOffset]
        }
        if (ch==='<') {
            tagOb = tag()
            tagName = tagOb.tagName
            whitespace()
        }
        switch(ch) {
            case '{':
                if (tagName && tagName!=='object') {
                    isTypeError(tagName, ch)
                }
                result = object()
            break
            case '[':
                if (tagName && tagName!=='array') {
                    isTypeError(tagName, ch)
                }
                result = array()
            break
            case '"':
                result = string(tagName)
            break
            case '-':
                result = number(tagName)
            break
            default:
                if (ch>='0' && ch<='9') {
                    result = number(tagName)
                } else {
                    result = boolOrNull(tagName)
                }
            break
        }
        if (tagOb) {
            if (result === null) {
                result = new Null()
            }
            if (typeof result !== 'object') {
                switch(typeof result) {
                    case 'string':
                        result = new String(result)
                        break
                    case 'number':
                        result = new Number(result)
                        break
                    default:
                        error('Syntax Error: unexpected type '+(typeof result))
                        break
                }
            }
            if (tagOb.tagName) {
                JSONTag.setType(result, tagOb.tagName)
            }
            if (tagOb.attributes) {
                JSONTag.setAttributes(result, tagOb.attributes)
                if (tagOb.attributes?.id) {
                    meta.index.id.set(tagOb.attributes.id, new WeakRef(result))
                }
            }
        }
        return result
    }

    function lengthValue() {
        let l = length()
        let v = valueProxy(l)
        return [l, v]
    }

    at = 0
    ch = " "
    let resultArray = []
    while(ch && at<input.length) {
        result = lengthValue()
        whitespace()
        offsetArray.push(at)
        resultArray.push(result[1])
    }

    if (typeof reviver === 'function') {
        function walk(holder, key)
        {
          var k;
          var v;
          var value = holder[key];
          if (value !== null 
                  && typeof value === "object" 
                  && !(value instanceof String 
                  || value instanceof Number
                  || value instanceof Boolean)
          ) {
              for (k in value) {
                  if (Object.prototype.hasOwnProperty.call(value, k)) {
                      v = walk(value, k);
                      if (v !== undefined 
                            && ( typeof value[k] === 'undefined' || value[k]!==v) )
                      {
                          value[k] = v;
                          if (JSONTag.getType(v)==='link') {
                                checkUnresolved(v, value, k)
                          }
                      } else if (v === undefined) {
                          delete value[k];
                      }
                  }
              }
          }
          return reviver.call(holder, key, value, meta);
        }
        
        walk({"":result}, "")
    }

    let replaceLink = function(u,value)
    {
        if (typeof value !== 'undefined') {
            let src = u.src.deref()
            if (typeof src!== 'undefined' && JSONTag.getType(src[u.key])==='link') {
                src[u.key] = value
                return true
            }
        }
    }

    if (meta.index.id.size>meta.unresolved.size) {
        meta.unresolved.forEach((links,id) => {
            let value = meta.index.id.get(id)?.deref()
            if (value!==undefined) {
                links.forEach((u,i) => {
                    if (replaceLink(u,value)) {
                        delete links[i]
                    }
                })
            }
        })
    } else {
        meta.index.id.forEach((ref,id) => {
            let value = ref.deref()
            let links = meta.unresolved.get(id)
            if (value!==undefined && typeof links !== 'undefined') {
                links.forEach((u,i) => {
                    replaceLink(u,value)
                })
                meta.unresolved.delete(id)
            }
        })
    }
    
    return resultArray
}

