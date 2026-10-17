import {
    at,
    text,
    type EventHandler,
    type OneBotNoticeEvent,
} from '@snowluma/sdk'
import { JsBotBasePlugin } from '../../core'
import { OnNotice } from '../../core/decorator/decorator'

export default class PokePlugin extends JsBotBasePlugin {
    @OnNotice(`notify`)
    poke: EventHandler<OneBotNoticeEvent> = async (event, ctx) => {
        if (event.sub_type !== 'poke') return
        if (event.target_id !== event.self_id) return
        const session = event.group_id
            ? Number(event.group_id)
            : Number(event.user_id)
        if (event.group_id)
            await this.bot.client.sendGroupMessage(
                session,
                at(Number(event.user_id)).text(`不许戳啦`).face(18)
            )
        else
            await this.bot.client.sendPrivateMessage(
                session,
                text(`不许戳啦`).face(18)
            )
    }
}
