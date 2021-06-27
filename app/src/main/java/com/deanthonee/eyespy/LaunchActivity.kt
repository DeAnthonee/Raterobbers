package com.deanthonee.eyespy

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import com.deanthonee.eyespy.databinding.ActivityLaunchBinding
import java.io.File

class LaunchActivity : AppCompatActivity() {

    companion object {
        const val TAKE_PHOTO_CODE = 1123
        const val PHOTO_FILE_NAME = "eyespy"
        const val AUTHORITY = "com.deanthonee.eyespy.fileprovider"
    }

    private lateinit var binding: ActivityLaunchBinding
    lateinit var photoFile: File

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLaunchBinding.inflate(layoutInflater)
        val view = binding.root
        setContentView(view)

        binding.takePhotoButton.setOnClickListener {
            takePhoto()
        }

    }

    private fun takePhoto() {
        val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        photoFile = getPhotoFile(PHOTO_FILE_NAME)
        val fileProvider = FileProvider.getUriForFile(this, AUTHORITY,photoFile)
        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, fileProvider)
        if (takePictureIntent.resolveActivity(this.packageManager) != null) {
            startActivityForResult(takePictureIntent, TAKE_PHOTO_CODE)
        }else{
            Toast.makeText(this,"No Camera App Sorry",Toast.LENGTH_SHORT).show()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == TAKE_PHOTO_CODE && resultCode == Activity.RESULT_OK) {
            processIntentForPic(data)
        }else{
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    private fun processIntentForPic(data: Intent?) {
        val takenImage = BitmapFactory.decodeFile(photoFile.absolutePath)
        val something = ExifUtil.rotateBitmap(photoFile.absolutePath, takenImage)
        binding.mainPic.setImageBitmap(something)
    }

    private fun getPhotoFile(fileName:String):File{
       val storageDirectory =  getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File.createTempFile(fileName,".jpg", storageDirectory)
    }
}