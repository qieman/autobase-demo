import Corestore from 'corestore'
import b4a from 'b4a'
import process from 'bare-process'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Hyperswarm from 'hyperswarm'


const storage = Pear.config.args[0]
const remoteKey = Pear.config.args[1] || null
const store = new Corestore(`./${storage || 'store1'}`)
const base = new Autobase(store, remoteKey, { apply, open, optimistic: true })
await base.ready()
await base.update()


const swarm = new Hyperswarm({ keyPair: base.local.keyPair })
swarm.on('connection', async (conn) => {
    await base.view.replicate(conn)
    console.log('🌐 Swarm 加入成功')
})
swarm.join(base.discoveryKey)

// create the view
function open(store) {
    return new Hyperbee(store.get("users"),
        { keyEncoding: 'utf-8', valueEncoding: 'json' })
}

// use apply to handle to updates
async function apply(nodes, view, host) {
    console.log('[nodes.length]:', nodes.length)
    for (const node of nodes) {
        const { value } = node
        if (value.addWriter) {
            await host.addWriter(value.addWriter, { indexer: true })
            continue
        }

        await host.ackWriter(node.from.key)
        await view.put(value.key, value)
    }
}

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
    }
})

async function list() {
    console.log('\n📊 用户列表:')
    console.log('-'.repeat(30))
    let count = 0
    for await (const entry of base.view.createReadStream()) {
        count++
        console.log(count, entry)
    }
    console.log('总数:', count)
    console.log('-'.repeat(30))
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
        const newKey = b4a.toString(base.key, 'hex')
        const user = await base.view.get(newKey)
        if (user) {
            console.log('❌ 用户已存在', user)
            return
        }

        await base.append({
            nickname: data,
            key: newKey,
            avatar: 'https://app.sola.day/images/default_avatar/avatar_0.png'
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
    console.log('/quit     - 退出应用程序')
}