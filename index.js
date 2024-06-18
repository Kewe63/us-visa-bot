#!/usr/bin/env node

import fetch from "node-fetch";
import cheerio from 'cheerio';
import qs from 'qs';

const EMAIL = process.env.EMAIL
const PASSWORD = process.env.PASSWORD
const SCHEDULE_ID = process.env.SCHEDULE_ID
const PREFERED_FACILITY_ID = process.env.FACILITY_ID
const LOCALE = process.env.LOCALE
const REFRESH_DELAY = Number(process.env.REFRESH_DELAY || 3)

const BASE_URI = `https://ais.usvisa-info.com/${LOCALE}/niv`
const APPOINTMENT_URI = `${BASE_URI}/schedule/${SCHEDULE_ID}/appointment`

let sessionHeaders = null

async function main(currentBookedDate) {
  if (!currentBookedDate) {
    log(`Invalid current booked date: ${currentBookedDate}`)
    process.exit(1)
  }

  log(`Initializing with current date ${currentBookedDate}`)

  try {
    sessionHeaders = await login()

    while(true) {
      const date = await checkAvailableDate()

      if (!date) {
        log("no dates available")
      } else if (date > currentBookedDate) {
        log(`nearest date is further than already booked (${currentBookedDate} vs ${date})`)
      } else {
        currentBookedDate = date
        const time = await checkAvailableTime(date)

        book(date, time)
          .then(d => log(`booked time at ${date} ${time}`))
      }

      await sleep(REFRESH_DELAY)
    }

  } catch(err) {
    console.error(err)
    log("Trying again")

    main(currentBookedDate)
  }
}

async function login() {
  log(`Logging in`)

  const anonymousHeaders = await fetch(`${BASE_URI}/users/sign_in`, {
    headers: {
      "User-Agent": "",
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
    },
  })
    .then(response => extractData(response))
    .then(data => data.headers)

  return fetch(`${BASE_URI}/users/sign_in`, {
    "headers": Object.assign({}, anonymousHeaders, {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }),
    "method": "POST",
    "body": new URLSearchParams({
      'utf8': '✓',
      'user[email]': EMAIL,
      'user[password]': PASSWORD,
      'policy_confirmed': '1',
      'commit': 'Acessar'
    }),
  })
    .then(res => (
      Object.assign({}, anonymousHeaders, {
        'Cookie': extractRelevantCookies(res)
      })
    ))
}

function checkAvailableDate() {
  const queryString = qs.stringify({
    appointments: {
      expedite: false
    }
  })

  return jsonRequest(`${APPOINTMENT_URI}/days/${PREFERED_FACILITY_ID}.json?` + queryString)
    .then(d => d.length > 0 ? d[0]['date'] : null)
}

function checkAvailableTime(date) {
  const queryString = qs.stringify({
    date: date,
    appointments: {
      expedite: false
    }
  })

  return jsonRequest(`${APPOINTMENT_URI}/times/${PREFERED_FACILITY_ID}.json?` + queryString)
    .then(d => d['business_times'][0] || d['available_times'][0])
}

function jsonRequest(url) {
  return fetch(url, {
    "headers": Object.assign({}, sessionHeaders, {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
    "cache": "no-store",
  })
    .then(response => response.json())
    .then(response => handleErrors(response))
}

function handleErrors(response) {
  const errorMessage = response['error']

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return response
}

async function book(date, time) {
  const newHeaders = await fetch(APPOINTMENT_URI, { "headers": sessionHeaders })
    .then(response => extractData(response))
    .then(data => data.headers)

  return fetch(APPOINTMENT_URI, {
    "method": "POST",
    "redirect": "follow",
    "headers": Object.assign({}, newHeaders, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    "body": new URLSearchParams({
      'utf8': '✓',
      'authenticity_token': newHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': PREFERED_FACILITY_ID,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    }),
  })
}

async function extractData(res) {
  const cookies = extractRelevantCookies(res)

  const html = await res.text()
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content')
  const facilities = parseSelectOptions($, '#appointments_consulate_appointment_facility_id')
  const ascFacilities = parseSelectOptions($, '#appointments_asc_appointment_facility_id')

  return {
    "headers": {
      "Cookie": cookies,
      "X-CSRF-Token": csrfToken,
      "Referer": BASE_URI,
      "Referrer-Policy": "strict-origin-when-cross-origin",
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive'
    },
    "facilities" : facilities,
    "ascFacilities": ascFacilities
  }
}

function extractRelevantCookies(res) {
  const parsedCookies = parseCookies(res.headers.get('set-cookie') || '')
  return `_yatri_session=${parsedCookies['_yatri_session']}`
}

function parseCookies(cookies) {
  const parsedCookies = {}

  cookies.split(';').map(c => c.trim()).forEach(c => {
    const [name, value] = c.split('=', 2)
    parsedCookies[name] = value
  })

  return parsedCookies
}

function parseSelectOptions($, selector) {
  return $(selector).find('option').get().map(el => $(el).val().trim()).filter(v => v)
}

function sleep(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}

function log(message) {
  console.log(`[${new Date().toISOString()}]`, message)
}

const args = process.argv.slice(2);
const currentBookedDate = args[0]
main(currentBookedDate)
