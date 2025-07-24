import Corestore from 'corestore'
import b4a from 'b4a'
import process from 'bare-process'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Hyperswarm from 'hyperswarm'


// 保存实例的文件名
const storage = Pear.config.args[0]
// 远程实例的base key
const remoteKey = Pear.config.args[1] || null

const store = new Corestore(`./${storage || 'store1'}`)
const base = new Autobase(store, remoteKey, { apply, open, optimistic: true, valueEncoding: 'json', ackInterval: 500 })
await base.ready()
await base.update()

const bee = new Hyperbee(store.get({ name: 'users' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })

const swarm = new Hyperswarm({ keyPair: base.local.keyPair })
swarm.on('connection', async (conn) => {
    await base.replicate(conn)
    console.log('🌐 Swarm 加入成功')
})
swarm.join(base.discoveryKey, { server: true, client: true })
await swarm.flush()

// create the view
function open(store) {
    console.log('[hypercore]: open')
    return store.get("all")
}

// use apply to handle to updates
async function apply(nodes, view, host) {
    console.log('[hypercore]: applying')
    for (const node of nodes) {
        const { value } = node
        await host.ackWriter(node.from.key)
        await view.append(JSON.stringify(value))
        console.log('[value]:', value)
        if (value.type === 'register') {
            await bee.put(`user_by_id:${value.data.id}`, value.data)
            await bee.put(`user_by_handle:${value.data.handle}`, value.data)
        }
    }
}

base.on(error => console.error('[hypercore]: error', error))

console.log('\n' + '-'.repeat(50))
console.log('[Base Key]:', b4a.toString(base.key, 'hex'))
console.log('[Local Key]:', b4a.toString(base.local.key, 'hex'))
console.log('[Discovery Key]:', b4a.toString(base.discoveryKey, 'hex'))

// 显示欢迎界面
help()
console.log('-'.repeat(50))

process.stdin.on('data', async (data) => {
    const message = data.toString().trim()
    if (message.startsWith('/list')) {
        await list()
    } else if (message.startsWith('/register')) {
        await register(message)
    } else if (message.startsWith('/help')) {
        help()
    } else if (message.startsWith('/quit')) {
        process.exit(0)
    } else if (message.startsWith('/add-writer')) {
        await addWriter(message)
    } else if (message.startsWith('/writable')) {
        console.log('[writable]:', base.writable)
    } else if (message.startsWith('/key')) {
        await add(message)
    } else if (message.startsWith('/ping')) {
        ping()
    } else if (message.startsWith('/clear')) {
        clearAll()
    }
})

async function list() {
    console.log('\n📊 base view 用户列表:')
    console.log('-'.repeat(30))
    for (let i = 0; i < base.view.length; i++) {
        console.log((await base.view.get(i)).toString())
    }
    console.log('总数:', base.view.length)
    console.log('-'.repeat(30))
    console.log('\n📊 bee 用户列表:')
    console.log('-'.repeat(30))
    let count = 0
    for await (const entry of bee.createReadStream()) {
        count++
        console.log(entry)
    }
    console.log('总数:', count)
    console.log('-'.repeat(30))
}

async function ping() {
    await base.append({type: 'ping', data: {time: new Date().toISOString(), user: b4a.toString(base.local.key, 'hex')}}, { optimistic: true })
}

async function addWriter(message) {
    const data = message.replace('/add-writer', '').trim()
    if (data) {
        const binary = b4a.from(data, 'hex')
        await base.append({ addWriter: binary })
        await base.update()
    }
}

async function register(message) {
    const data = message.replace('/register', '').trim()
    if (data) {
        await base.append({
            type: 'register',
            data: {
                handle: data,
                nickname: '',
                id: b4a.toString(base.local.key, 'hex'),
                image_url: 'https://app.sola.day/images/default_avatar/avatar_0.png',
                created_at: Date.now(),
            }
        }, { optimistic: true })
        await base.update()
        console.log(`✅ 数据已添加: "${data}"`)
    }
}

function help() {
    console.log('[可用命令]:')
    console.log('/list     - 查看所有user数据')
    console.log('/register <用户名> - 注册用户')
    console.log('/add-writer <身份公钥> - 添加写入者')
    console.log('/help     - 显示此帮助信息')
    console.log('/writable - 查看是否可写')
    console.log('/clear - 清除所有数据')
    console.log('/ping - 测试连接')
    console.log('/quit     - 退出应用程序')
}

function clearAll() {
    console.log('清除所有数据...')
    console.log(base.view)
    base.view.clear(0, base.view.length)
    console.log('所有数据已清除')
}

