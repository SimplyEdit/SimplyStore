import fs from 'fs'
import JSONTag from '@muze-nl/jsontag'
import JSONTagTypes from '@muze-nl/jsontag-types'

const data = JSON.parse(fs.readFileSync(process.cwd()+'/star-wars-dataset/data/enriched.json'))

let result = {}

Object.entries(data.root).forEach(([key,src]) => {
	result[key] = []
	JSONTag.setAttribute(result[key], 'src', src)
})

class myDatetime {
	constructor(dt) {
		if (dt) {
			if (dt.lastIndexOf('.')!=-1) {
				this.value = dt.substr(0, dt.lastIndexOf('.'))
			} else if (dt.lastIndexOf('Z')) {
				this.value = dt.substr(0, dt.lastIndexOf('Z'))
			}
		} else {
			this.value = null
		}
		JSONTag.setType(this, 'datetime')
	}
	toJSONTag() {
		return JSONTag.getTypeString(this)+JSON.stringify(this.value)
	}
}

function myParseInt(value, type) {
	let v = parseInt(value) 
	if (isNaN(v)) {
		v = new JSONTag.Null()
	} else {
		v = new Number(v)
	}
	JSONTag.setType(v, type)
	return v
}

function myParseFloat(value, type) {
	let v = parseFloat(value) 
	if (isNaN(v)) {
		v = new JSONTag.Null()
	} else {
		v = new Number(v)
	}
	JSONTag.setType(v, type)
	return v
}

function myString(value, type) {
	let v = new String(value)
	JSONTag.setType(v, type)
	return v
}

result.people = data.people.map(entity => {
	let person = {}
	JSONTag.setAttribute(person, 'id', entity.url)
	person.name = myString(entity.name, 'text')
	let height = parseInt(entity.height)
	person.height = isNaN(height) ? new JSONTag.Null() : new JSONTagTypes.Decimal(height, 2)
	person.hair_color = entity.hair_color
	person.skin_color = entity.skin_color
	person.eye_color = entity.eye_color
	person.birth_year = entity.birth_year
	person.gender = entity.gender
	person.homeworld = new JSONTag.Link(entity.homeworld)
	person.films = entity.films.map(f => new JSONTag.Link(f))
	person.species = entity.species.map(s => new JSONTag.Link(s))
	person.vehicles = entity.vehicles.map(v => new JSONTag.Link(v))
	person.starships = entity.starships.map(s => new JSONTag.Link(s))
	person.created = new myDatetime(entity.created)
	person.edited = new myDatetime(entity.edited)
	person.desc = myString(entity.desc?.join("\n"), 'text')
	return person
})

result.films = data.films.map(entity => {
	let film = {}
	JSONTag.setAttribute(film, 'id', entity.url)
	film.title = myString(entity.title, 'text')
	film.episode_id = entity.episode_id
	film.opening_crawl = myString(entity.opening_crawl, 'text')
	film.director = myString(entity.director, 'text')
	film.producer = myString(entity.producer, 'text')
	film.release_date = new JSONTagTypes.Date(entity.release_date)
	film.charachters = entity.characters.map(c => new JSONTag.Link(c))
	film.planets = entity.planets.map(p => new JSONTag.Link(p))
	film.starships = entity.starships.map(s => new JSONTag.Link(s))
	film.vehicles = entity.vehicles.map(v => new JSONTag.Link(v))
	film.species = entity.species.map(s => new JSONTag.Link(s))
	film.created = new myDatetime(entity.created)
	film.edited = new myDatetime(entity.edited)
	film.url = myString(entity.url, 'url')
	film.desc = myString(entity.desc?.join("\n"), 'text')
	return film
})

result.planets = data.planets.map(entity => {
	let planet = {}
	JSONTag.setAttribute(planet, 'id', entity.url)
	planet.rotation_period = myParseInt(entity.rotation_period, 'uint8')
	planet.diameter = myParseInt(entity.orbital_period, 'uint16')
	planet.climate = entity.climate
	planet.gravity = entity.gravity
	planet.terrain = entity.terrain.split(',').map(t => t.trim())
	planet.surface_water = myParseInt(entity.surface_water, 'uint8')
	JSONTag.setAttribute(planet.surface_water, 'class', 'percentage')
	planet.population = myParseInt(entity.population, 'uint')
	planet.residents = entity.residents.map(r => new JSONTag.Link(r))
	planet.films = entity.films.map(f => new JSONTag.Link(f))
	planet.created = new myDatetime(entity.created)
	planet.edited = new myDatetime(entity.edited)
	planet.url = myString(entity.url, 'url')
	planet.desc = myString(entity.desc?.join("\n"), 'text')
	return planet
})

result.species = data.species.map(entity => {
	let species = {}
	JSONTag.setAttribute(species, 'id', entity.url)
	species.name = myString(entity.name, 'text')
	species.classification = myString(entity.classification, 'text')
	species.designation = myString(entity.designation, 'text')
	species.averate_height = myParseInt(entity.average_height, 'uint16')
	species.skin_colors = entity.skin_colors.split(',').map(c => c.trim())
	species.hair_colors = entity.hair_colors.split(',').map(c => c.trim())
	species.eye_colors = entity.eye_colors.split(',').map(c => c.trim())
	species.average_lifespan = myParseInt(entity.average_lifespan, 'uint')
	species.homeworld = entity.homeworld ? new JSONTag.Link(entity.homeworld) : null
	species.language = myString(entity.language, 'text')
	species.films = entity.films.map(f => new JSONTag.Link(f))
	species.created = new myDatetime(entity.created)
	species.edited = new myDatetime(entity.edited)
	species.url = myString(entity.url, 'text')
	species.desc = myString(entity.desc?.join("\n"), 'text')
	return species
})

result.vehicles = data.vehicles.map(entity => {
	let vehicle = {}
	JSONTag.setAttribute(vehicle, 'id', entity.url)
	vehicle.name = myString(entity.name, 'text')
	vehicle.model = myString(entity.model, 'text')
	vehicle.manufacturer = myString(entity.manufacturer, 'text')
	let cost = parseInt(entity.cost_in_credits) || new JSONTag.Null()
	if (JSONTag.isNull(cost)) {
		vehicle.cost = cost
		JSONTag.setType(cost, 'money')
	} else {
		vehicle.cost = new JSONTagTypes.Money('SWC',cost,0)
	}
	vehicle.length = myParseFloat(entity.length, 'float')
	vehicle.max_atmosphering_speed = myParseInt(entity.max_atmosphering_speed, 'uint')
	vehicle.crew = myParseInt(entity.crew, 'uint')
	vehicle.passengers = myParseInt(entity.passengers, 'uint')
	vehicle.cargo_capacity = myParseInt(entity.carge_capacity,'uint')
	vehicle.consumables = myString(entity.consumables, 'text')
	vehicle.vehicle_class = myString(entity.vehicle_class, 'text')
	vehicle.pilots = entity.pilots.map(p => new JSONTag.Link(p))
	vehicle.films = entity.films.map(f => new JSONTag.Link(f))
	vehicle.created = new myDatetime(entity.created)
	vehicle.edited = new myDatetime(entity.edited)
	vehicle.url = myString(entity.url, 'text')
	vehicle.desc = myString(entity.desc?.join("\n"), 'text')
	return vehicle	
})

result.starships = data.starships.map(entity => {
	let starship = {}
	JSONTag.setAttribute(starship, 'id', entity.url)
	starship.name = myString(entity.name, 'text')
	starship.model = myString(entity.model, 'text')
	starship.manufacturer = myString(entity.manufacturer, 'text')
	let cost = parseInt(entity.cost_in_credits) || new JSONTag.Null()
	if (JSONTag.isNull(cost)) {
		starship.cost = cost
		JSONTag.setType(cost, 'money')
	} else {
		starship.cost = new JSONTagTypes.Money('SWC',cost,0)
	}
	starship.length = myParseFloat(entity.length, 'float')
	starship.max_atmosphering_speed = myParseInt(entity.max_atmosphering_speed, 'uint')
	starship.crew = myParseInt(entity.crew, 'uint')
	starship.passengers = myParseInt(entity.passengers, 'uint')
	starship.cargo_capacity = myParseInt(entity.carge_capacity,'uint')
	starship.consumables = myString(entity.consumables, 'text')
	starship.hyperdrive_rating = myParseFloat(entity.hyperdrive_rating, 'float')
	starship.MGLT = myParseInt(entity.MGLT, 'uint')
	starship.starship_class = myString(entity.starship_class, 'text')
	starship.pilots = entity.pilots.map(p => new JSONTag.Link(p))
	starship.films = entity.films.map(f => new JSONTag.Link(f))

	starship.created = new myDatetime(entity.created)
	starship.edited = new myDatetime(entity.edited)
	starship.url = myString(entity.url, 'text')
	starship.desc = myString(entity.desc?.join("\n"), 'text')
	return starship	
})

let out = JSONTag.stringify(result, null, 4)
console.log(out)