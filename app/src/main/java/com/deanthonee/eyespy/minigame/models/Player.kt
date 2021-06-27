package com.deanthonee.eyespy.minigame.models

data class Player(
    val playerId: String,
    val playerName: String,
    var bank: Int,
    var pouch: Int
)

fun Player.addMoney() {
    this.pouch += 1
}

data class TurnResults(
    val listOfPlayers: List<Player>,
    val turnNumber: Int,
    val potAmount:Int,
)