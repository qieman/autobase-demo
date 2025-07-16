#!/usr/bin/env node

import p from 'paparam'
import Autobase from 'autobase'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'

class View {
  open (store) {
    const core = store.get('view')
    return core
  }

  async apply (nodes, view, host) {
    for (const node of nodes) {
      const value = JSON.parse(node.value)

      if (value.add) {
        await host.addWriter(Buffer.from(value.add, 'hex'))
      }

      if (value.gets) {
        const all = []
        for (const delta of value.gets) {
          const seq = view.length - delta
          if (seq < 0 || view.length <= seq) continue
          // console.log('waiting for a block', seq, view.length, view.signedLength)
          const val = JSON.parse(await view.get(seq))
          // console.log('got it!')
          all.push({ seq, value })
        }

        await view.append(JSON.stringify({ gets: all }))
      }

      await view.append(JSON.stringify({ echo: value }))
    }
  }

  close (view) {
    return view.close()
  }
}

const args = p.command('autobase-example',
  p.flag('--name [name]'),
  p.flag('--key [key]'),
  p.flag('--add [key]'),
  p.flag('--spam [messages-per-second]'),
  p.flag('--swarm'),
  p.flag('--audit')
).parse()

if (!args) process.exit(0)

const name = args.flags.name || 'a'
const key = args.flags.key || null
const spam = args.flags.spam ? Number(args.flags.spam || 1) : 0
const pace = spam ? Math.max(10, Math.round(100 / spam)) : 0
const n = Math.max(1, Math.ceil(spam / 100))

const store = new Corestore('store/' + name)

if (args.flags.audit) {
  for await (const { discoveryKey } of store.storage.createCoreStream()) {
    const core = store.get({ discoveryKey, active: false })
    await core.ready()
    console.log('audited', core.id, await core.core.audit())
    await core.close()
  }
}

const ns = key || await Autobase.getLocalKey(store)
const base = new Autobase(store.namespace(ns), key, new View())

await base.ready()

if (args.flags.swarm) {
  const swarm = new Hyperswarm({
    keyPair: base.local.keyPair
  })
  swarm.on('connection', c => base.replicate(c))
  swarm.join(base.discoveryKey)
}

console.log('Base key', base.key.toString('hex'))
console.log('Local key', base.local.key.toString('hex'))
console.log()

setInterval(async function () {
  console.log('base stats:',
    'length=', base.length,
    'indexed-length=', base.indexedLength,
    'signed-length=', base.signedLength,
    'members=', base._applyState.system.members, '(', base.linearizer.indexers.length, ')',
    'peers=', base.core.peers.length
  )
  const seq = base.view.length - 1
  if (seq < 0) return
  const last = await base.view.get(seq)
  console.log('last message (', seq, ') is', JSON.parse(last))
}, 2000)

if (base.writable) {
  await onwritable()
} else {
  console.log('waiting to become writable...')
  base.once('writable', onwritable)
}

async function onwritable () {
  console.log('we are writable!')

  if (args.flags.add) {
    await base.append(JSON.stringify({ add: args.flags.add }))
  }

  if (pace) {
    while (true) {
      for (let i = 0; i < n; i++) await append()
      await new Promise(resolve => setTimeout(resolve, pace))
    }
  }

  async function append () {
    if (Math.random() < 0.2) {
      const gets = []
      const len = Math.floor(Math.random() * 20)

      for (let i = 0; i < len; i++) {
        gets.push(Math.floor(Math.random() * base.view.length))
      }

      await base.append(JSON.stringify({ gets }))
      return
    }

    await base.append(JSON.stringify({ hello: 'world', time: Date.now(), from: name }))
  }
}