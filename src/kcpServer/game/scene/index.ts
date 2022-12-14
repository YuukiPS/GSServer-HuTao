import BaseClass from '#/baseClass'
import { PacketContext } from '#/packet'
import GuestBeginEnterScene from '#/packets/GuestBeginEnterScene'
import PlayerEnterScene, { PlayerEnterSceneNotify } from '#/packets/PlayerEnterScene'
import ScenePlayerLocation from '#/packets/ScenePlayerLocation'
import SceneTime from '#/packets/SceneTime'
import uidPrefix from '#/utils/uidPrefix'
import Entity from '$/entity'
import Vehicle from '$/entity/gadget/vehicle'
import DungeonData from '$/gameData/data/DungeonData'
import SceneData from '$/gameData/data/SceneData'
import CombatManager from '$/manager/combatManager'
import EntityManager from '$/manager/entityManager'
import VehicleManager from '$/manager/vehicleManager'
import Player from '$/player'
import Vector from '$/utils/vector'
import World from '$/world'
import Logger from '@/logger'
import { ClientStateEnum } from '@/types/enum'
import { AbilityInvokeEntry, CombatInvokeEntry, PlayerWorldSceneInfo, ScenePlayerInfo, SceneTeamAvatar } from '@/types/proto'
import { ProtEntityTypeEnum, SceneEnterReasonEnum, SceneEnterTypeEnum } from '@/types/proto/enum'
import SceneUserData from '@/types/user/SceneUserData'
import { getTimeSeconds } from '@/utils/time'
import SceneBlock from './sceneBlock'
import SceneTag from './sceneTag'

const logger = new Logger('GSCENE', 0xefa8ec)

export default class Scene extends BaseClass {
  world: World

  id: number
  type: string
  enterSceneToken: number

  unlockedPointList: number[]

  sceneTagList: SceneTag[]
  sceneBlockList: SceneBlock[]

  entityManager: EntityManager
  combatManager: CombatManager
  vehicleManager: VehicleManager

  playerList: Player[]

  timestampSceneTime: number
  timestamp: number
  paused: boolean

  dieY: number

  isLocked: boolean
  beginTime: number

  lastLocUpdate: number
  lastTimeUpdate: number

  sceneBlockInit: boolean
  destroyed: boolean

  constructor(world: World, sceneId: number) {
    super()

    this.world = world

    this.id = sceneId
    this.enterSceneToken = Math.floor(Math.random() * 1e4)

    this.unlockedPointList = []

    this.sceneTagList = []
    this.sceneBlockList = []

    this.entityManager = new EntityManager(this)
    this.combatManager = new CombatManager(this)
    this.vehicleManager = new VehicleManager(this)

    this.playerList = []

    this.dieY = 0

    super.initHandlers(this)
  }

  private async loadSceneData() {
    const { id } = this
    const sceneData = await SceneData.getScene(id)

    this.type = sceneData.Type || 'SCENE_WORLD'

    this.sceneTagList = sceneData?.Tag?.map(tagData => new SceneTag(this, tagData)) || []
    this.sceneBlockList = Object.keys(sceneData?.Block || {}).map(e => new SceneBlock(this, parseInt(e)))

    this.dieY = sceneData?.DieY || 0
    this.isLocked = !!sceneData?.IsLocked
  }

  get broadcastContextList(): PacketContext[] {
    return this.playerList.map(player => player.context)
  }

  get host(): Player {
    return this.world.host
  }

  get sceneTime(): number {
    const { timestampSceneTime, timestamp, paused } = this
    if (paused) return timestampSceneTime
    return Math.floor(timestampSceneTime + (Date.now() - timestamp))
  }

  set sceneTime(v) {
    this.timestampSceneTime = v
    this.timestamp = Date.now()

    SceneTime.broadcastNotify(this.broadcastContextList)
  }

  async init(userData: SceneUserData, fullInit: boolean) {
    const { entityManager, enterSceneToken } = this
    const { unlockedPointList, sceneTime } = userData
    const scenePerfMark = `SceneInit-${enterSceneToken}`

    Logger.mark(scenePerfMark)

    await this.loadSceneData()

    entityManager.init()

    if (Array.isArray(unlockedPointList)) {
      for (const pointId of unlockedPointList) this.unlockPoint(pointId)
    }

    this.beginTime = Date.now()
    this.sceneTime = sceneTime || 0

    if (fullInit) this.initSceneBlocks()

    Logger.measure('Scene init', scenePerfMark)
    Logger.clearMarks(scenePerfMark)
  }

  async initNew(fullInit: boolean) {
    const { entityManager, enterSceneToken } = this
    const scenePerfMark = `SceneInit-${enterSceneToken}`

    Logger.mark(scenePerfMark)

    await this.loadSceneData()

    entityManager.init()

    this.beginTime = Date.now()
    this.sceneTime = 0

    if (fullInit) this.initSceneBlocks()

    Logger.measure('Scene init', scenePerfMark)
    Logger.clearMarks(scenePerfMark)
  }

  async destroy() {
    const { world, id, entityManager, vehicleManager, sceneBlockList } = this
    const { sceneDataMap, sceneList } = world

    this.destroyed = true

    sceneDataMap[id] = this.exportUserData()

    await entityManager.destroy()
    await vehicleManager.destroy()

    delete this.sceneTagList
    for (const sceneBlock of sceneBlockList) await sceneBlock.unload()

    this.unregisterHandlers()

    if (sceneList.includes(this)) sceneList.splice(sceneList.indexOf(this), 1)
  }

  async initSceneBlocks() {
    const { sceneBlockList, sceneBlockInit } = this

    if (sceneBlockInit) return
    this.sceneBlockInit = true

    for (const block of sceneBlockList) await block.initNew()
  }

  unlockPoint(pointId: number): boolean {
    const { unlockedPointList } = this
    pointId = parseInt(pointId?.toString())
    if (isNaN(pointId) || unlockedPointList.includes(pointId)) return false

    unlockedPointList.push(pointId)
    return true
  }

  pause() {
    const { world, paused, sceneTime } = this
    if (paused || world.mpMode) return

    this.paused = true
    this.sceneTime = sceneTime
  }

  unpause() {
    const { timestampSceneTime, paused } = this
    if (!paused) return

    this.paused = false
    this.sceneTime = timestampSceneTime
  }

  async abilityInvoke(context: PacketContext, invokes: AbilityInvokeEntry[]) {
    if (invokes == null || invokes.length === 0) return

    const { entityManager } = this
    for (const entry of invokes) {
      const entity = entityManager.getEntity(entry?.entityId)
      if (entity == null) {
        logger.debug('Ability invoke to null entity:', entry)
        continue
      }
      await entity?.abilityManager?.emit('AbilityInvoke', context, entry)
    }
  }

  async clientAbilityChange(context: PacketContext, invokes: AbilityInvokeEntry[], entityId: number, flag: boolean) {
    if (invokes == null || invokes.length === 0) return

    const { entityManager } = this
    const { player, seqId } = context
    const { forwardBuffer } = player
    const entity = entityManager.getEntity(entityId)

    forwardBuffer.setAdditionalData(seqId, entityId, !!flag)

    for (const entry of invokes) await entity?.abilityManager?.emit('ClientAbilityChange', context, entry)
  }

  async clientAbilityInitFinish(context: PacketContext, invokes: AbilityInvokeEntry[], entityId: number) {
    if (invokes == null || invokes.length === 0) return

    const { entityManager } = this
    const { player, seqId } = context
    const { forwardBuffer } = player
    const entity = entityManager.getEntity(entityId)

    forwardBuffer.setAdditionalData(seqId, entityId)

    for (const entry of invokes) await entity?.abilityManager?.emit('ClientAbilityInitFinish', context, entry)
  }

  async combatInvoke(context: PacketContext, invokes: CombatInvokeEntry[]) {
    if (invokes == null || invokes.length === 0) return

    const { combatManager } = this
    for (const entry of invokes) await combatManager.emit('CombatInvoke', context, entry)
  }

  async spawnDropsById(pos: Vector, dropId: number, seqId?: number) {
    const { playerList } = this
    for (const player of playerList) player.energyManager.spawnDropsById(pos, dropId, seqId)
  }

  async join(
    context: PacketContext,
    pos: Vector,
    rot: Vector,
    enterType: SceneEnterTypeEnum = SceneEnterTypeEnum.ENTER_NONE,
    enterReason: SceneEnterReasonEnum = SceneEnterReasonEnum.NONE
  ): Promise<boolean> {
    const { world, id, host, enterSceneToken, sceneTagList, playerList, beginTime } = this
    const { player } = context
    const { state, currentScene, pos: playerPos, rot: playerRot } = player

    let sceneType = (state & 0x0F00)
    switch (enterReason) {
      case SceneEnterReasonEnum.DUNGEON_ENTER:
        sceneType = ClientStateEnum.SCENE_DUNGEON
        break
      case SceneEnterReasonEnum.DUNGEON_QUIT:
        sceneType = ClientStateEnum.SCENE_WORLD
        break
    }

    // Set client state
    player.state = ClientStateEnum.PRE_ENTER_SCENE | sceneType

    player.nextScene = this

    if (currentScene) await player.currentScene.leave(context)

    logger.debug(uidPrefix('JOIN', host, 0xefef00), `UID: ${player.uid} ID: ${id} Pos: [${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}] Type: ${SceneEnterTypeEnum[enterType]} Reason: ${SceneEnterReasonEnum[enterReason]}`)

    if (!world.isHost(player)) await GuestBeginEnterScene.sendNotify(host.context, this, player)

    const playerEnterSceneData: PlayerEnterSceneNotify = {
      sceneId: id,
      pos: pos.export(),
      sceneBeginTime: beginTime.toString(),
      type: enterType,
      targetUid: host.uid,
      worldLevel: world.level,
      enterSceneToken,
      isFirstLoginEnterScene: enterReason === SceneEnterReasonEnum.LOGIN,
      sceneTagIdList: sceneTagList.filter(tag => tag.isActive()).map(tag => tag.id),
      enterReason,
      worldType: 1,
      sceneTransaction: `${id}-${host.uid}-${getTimeSeconds()}-33696`
    }

    if (currentScene && playerPos) {
      const prevPos = new Vector()
      prevPos.copy(playerPos)

      playerEnterSceneData.prevSceneId = currentScene.id
      playerEnterSceneData.prevPos = prevPos
    }

    const dungeonData = await DungeonData.getDungeonByScene(id)
    if (dungeonData) playerEnterSceneData.dungeonId = dungeonData.Id

    PlayerEnterScene.sendNotify(context, playerEnterSceneData)

    player.sceneEnterType = enterType

    player.currentScene = this
    player.nextScene = null

    if (!playerList.includes(player)) playerList.push(player)

    playerPos.copy(pos)
    playerRot.copy(rot)

    await player.emit('SceneJoin', this, context)

    // Set client state
    player.state = ClientStateEnum.ENTER_SCENE | sceneType

    return true
  }

  async leave(context: PacketContext) {
    const { id, host, playerList } = this
    const { player } = context
    const { uid } = player

    // Check if player is in scene
    if (!playerList.includes(player)) return

    logger.debug(uidPrefix('QUIT', host, 0xffff00), `UID: ${uid} ID: ${id}`)

    // Set client state
    player.state = ClientStateEnum.POST_LOGIN | (player.state & 0x0F00)

    player.currentScene = null
    playerList.splice(playerList.indexOf(player), 1)

    await player.emit('SceneLeave', this, context)
    await this.emit('PlayerLeave', player)

    // Destroy scene if no player is inside
    if (playerList.length > 0 || player.nextScene === this) return

    await this.destroy()
  }

  exportSceneTeamAvatarList(): SceneTeamAvatar[] {
    const { playerList } = this
    return [].concat(...playerList.map(player => player.teamManager.exportSceneTeamAvatarList()))
  }

  exportSceneInfo(): PlayerWorldSceneInfo {
    const { id, sceneTagList, isLocked } = this

    return {
      sceneId: id,
      sceneTagIdList: sceneTagList.filter(tag => tag.isActive()).map(tag => tag.id),
      isLocked
    }
  }

  exportScenePlayerInfoList(): ScenePlayerInfo[] {
    return this.playerList.map(p => p.exportScenePlayerInfo())
  }

  exportUserData(): SceneUserData {
    const { unlockedPointList, sceneTime } = this

    return {
      unlockedPointList,
      sceneTime
    }
  }

  /**Events**/

  // SceneUpdate
  async handleSceneUpdate() {
    const { id, vehicleManager, sceneBlockList, playerList, broadcastContextList, lastLocUpdate, lastTimeUpdate } = this

    for (const sceneBlock of sceneBlockList) await sceneBlock.emit('Update')

    if (lastLocUpdate == null || Date.now() - lastLocUpdate > 5e3) {
      this.lastLocUpdate = Date.now()
      await ScenePlayerLocation.broadcastNotify(broadcastContextList, {
        sceneId: id,
        playerLocList: playerList.map(player => player.exportLocationInfo()),
        vehicleLocList: vehicleManager.exportVehicleLocationInfoList()
      })
    }

    if (lastTimeUpdate == null || Date.now() - lastTimeUpdate > 10e3) {
      this.lastTimeUpdate = Date.now()
      await SceneTime.broadcastNotify(broadcastContextList)
    }
  }

  // PlayerJoin
  async handlePlayerJoin() {
    const { sceneBlockList } = this
    for (const sceneBlock of sceneBlockList) await sceneBlock.updateNonDynamic()
  }

  // EntityUpdate
  async handleEntityUpdate(entity: Entity) {
    if (entity instanceof Vehicle) entity.syncMemberPos()
    if (entity.protEntityType === ProtEntityTypeEnum.PROT_ENTITY_AVATAR) {
      const { sceneBlockList } = this
      for (const sceneBlock of sceneBlockList) await sceneBlock.updateNonDynamic()
    }
  }
}