import { Hono } from 'hono'
import { renderRankingsPage } from './page.js'

export const app = new Hono()

app.get('/', c => c.html(renderRankingsPage()))
