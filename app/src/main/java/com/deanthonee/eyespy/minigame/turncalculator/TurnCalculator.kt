package com.deanthonee.eyespy.minigame.turncalculator

import com.deanthonee.eyespy.minigame.models.Player
import com.deanthonee.eyespy.minigame.models.TurnResults

interface TurnCalculator {
    var turnNumber: Int

    fun processTurn(list: Triple<Player, Player, Player>): TurnResults
}